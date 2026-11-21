import assert from "node:assert/strict";
import test from "node:test";
import {verifyWorkbenchClients} from "./remote_workbench_clients.mjs";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { request } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";

const run = promisify(execFile);
const project = fileURLToPath(new URL("../..",import.meta.url));
const binary = resolve(process.argv[2] || join(project,"build/native/ngb"));
const python = "/usr/bin/python3";
const cap = 128 * 1024;

// The kernel accepts the first 128 KiB of a large export, then rejects its next
// write with EFBIG. Both launchers use their production file-writing code.
const limitedExec = [
  "import os, resource, signal, sys",
  "signal.signal(signal.SIGXFSZ, signal.SIG_IGN)",
  "resource.setrlimit(resource.RLIMIT_FSIZE, (int(sys.argv[1]),int(sys.argv[1])))",
  "os.execv(sys.argv[2],sys.argv[2:])"
].join("\n");

function post(address, payload) {
  const body = JSON.stringify(payload);
  return new Promise((resolvePost,reject) => {
    const headers = {"Content-Type":"application/json","Content-Length":Buffer.byteLength(body)};
    if (address.port) headers.origin = "http://127.0.0.1:" + address.port;
    const req = request({...address,method:"POST",headers,agent:false}, res => {
      const parts = [];
      res.on("data",chunk=>parts.push(chunk));
      res.on("error",reject);
      res.on("end",()=>{
        try { resolvePost(JSON.parse(Buffer.concat(parts).toString())); }
        catch (error) { reject(error); }
      });
    });
    req.setTimeout(7000,()=>req.destroy(new Error("Workbench protocol timeout")));
    req.on("error",reject);
    req.end(body);
  });
}

async function start(adapter, dir, roots, defaultState=false) {
  let stateFile=defaultState ? undefined : join(roots[0],adapter+".state");
  const app=adapter==="elf" ? [join(dir,"deploy/ngb")] : [process.execPath,join(project,"tools/serve.mjs")];
  const options={cwd:dir,env:{...process.env,NGB_LOG_DIR:join(dir,"logs-"+adapter)}};
  if (adapter==="elf") options.env.PATH="/nonexistent";
  const stateArgs=defaultState ? ["--interactive"] : ["--no-interactive","--state-file",stateFile];
  const child=spawn(python,["-c",limitedExec,String(cap),...app,"start","--no-open",
    "--port","0",...stateArgs,...roots.flatMap(root=>["--browse-root",root])],options);
  if(!defaultState)child.stdin.end();
  const done=once(child,"close");
  let output="",errorOutput="";
  child.stdout.on("data",chunk=>{output+=chunk;});
  child.stderr.on("data",chunk=>{errorOutput=(errorOutput+chunk).slice(-5000);});
  try{
    const end=Date.now()+10000;
    while(!output.includes("\n") && child.exitCode===null && Date.now()<end) await sleep(20);
    if(!output.includes("\n"))throw new Error(adapter+" failed to start: "+errorOutput);
    const ready=JSON.parse(output.trim());
    assert.equal(ready.event,"ready");
    stateFile=ready.stateFile;
    const state=JSON.parse(await readFile(stateFile,"utf8"));
    const token=new URLSearchParams(new URL(ready.pairUrl).hash.slice(1)).get("ngb");
    const admin=(op,fields={})=>post({socketPath:state.control,path:"/"},{version:1,op,...fields});
    const page=(identity,op,fields={})=>post({hostname:"127.0.0.1",port:ready.port,path:"/__ngb/workbench"},{version:1,op,...identity,...fields});
    const register=()=>page({},"join",{token});
    async function stop() {
      if(child.exitCode!==null || child.signalCode!==null)return;
      await run(app[0],[...app.slice(1),"stop","--state-file",stateFile],options);
      await done;
      assert.equal(output.trim().split(/\r?\n/).length,1,"redirected launcher emits one ready record");
      await assert.rejects(access(state.control),{code:"ENOENT"});
      await assert.rejects(access(stateFile),{code:"ENOENT"});
      await assert.rejects(register(),{code:"ECONNREFUSED"});
    }
    const status=()=>run(app[0],[...app.slice(1),"status","--state-file",stateFile],options);
    const cleanup=async()=>{if(child.exitCode===null && child.signalCode===null){child.kill();await done;}};
    return {admin,page,register,stop,stateFile,status,cleanup};
  }catch(e){child.kill();await done;throw e;}
}

async function check(adapter,s,dir,roots,t){
  const available=(...args)=>s.admin("command",{id:"catalogue-scope",argv:["commands","--available",...args]});
  const names=reply=>reply.result.map(row=>row.name);
  await t.test(adapter+" R01 catalogue is usable before pairing",async()=>{
    const reply=await available();
    assert.equal(reply.status,"committed");
    assert.ok(names(reply).includes("page new"));
    assert.ok(reply.result.every(row=>row.target!=="page" && row.capability==="v1"));
    assert.equal((await available("--page","missing")).error.code,"PAGE_UNAVAILABLE");
  });
  const a=await s.register();
  await s.page(a,"poll",{context:{mode:"Single",pickerState:"closed"}});
  assert.equal((await available()).page,a.page);
  const b=await s.register();
  await verifyWorkbenchClients({adapter, service:s, page:a, dir, project, t});
  const command=(id, ...argv)=>s.admin("command",{id,argv,page:a.page,cwd:roots[0]});
  const job=(op,id,...args)=>command("check-"+op,"job",op,id,...args);
  const poll=()=>s.page(a,"poll");
  const grant=(id)=>s.page(a,"grant",{id});
  const ack=(id,result)=>s.page(a,"ack",{id,result});
  const receipt=async(id,expected)=>assert.equal((await s.admin("status",{id})).status,expected);
  await t.test(adapter+" R01 available actions follow document mode, Compare side and picker state",async()=>{
    const ambiguous=await available();
    assert.equal(ambiguous.error.code,"PAGE_REQUIRED");
    assert.deepEqual(ambiguous.error.candidates.sort(),[a.page,b.page].sort());
    await s.page(a,"poll",{context:{mode:"AIG",pickerState:"closed"}});
    await s.page(b,"poll",{context:{mode:"Compare",pickerState:"open"}});
    const aigNames=names(await available("--page",a.page));
    for(const name of ["aig add","module open","files browse"]) assert.ok(aigNames.includes(name));
    for(const name of ["timing open","timing show","golden load","files choose","files submit"])
      assert.ok(!aigNames.includes(name));
    assert.equal((await available("--page",a.page,"--side","B")).error.code,"INVALID_SIDE");
    const compareNames=names(await available("--page",b.page));
    assert.ok(compareNames.includes("files choose"));
    assert.ok(!compareNames.includes("files submit"));
    assert.ok(!compareNames.includes("svg export"));
    const sideNames=names(await available("--page",b.page,"--side","A"));
    for(const name of ["timing add","svg export","timing show"]) assert.ok(sideNames.includes(name));
    for(const name of ["aig add","module open","fs ls"]) assert.ok(!sideNames.includes(name));
    await s.page(b,"poll",{context:{mode:"Compare",pickerState:"selected"}});
    assert.ok(names(await available("--page",b.page)).includes("files submit"));
    await s.page(a,"poll",{context:{mode:"Single",pickerState:"closed"}});
    const full=await s.admin("command",{argv:["commands","--page","missing"]});
    assert.equal(full.result.length,180);
    const logs=join(dir,"logs-"+adapter);
    const files=(await readdir(logs)).filter(name=>name.endsWith(".error.jsonl"));
    const records=(await Promise.all(files.map(name=>readFile(join(logs,name),"utf8"))))
      .flatMap(data=>data.trim().split("\n").filter(Boolean).map(line=>JSON.parse(line)));
    const denied=records.filter(row=>row.details?.requestId==="catalogue-scope" && row.details.code==="INVALID_SIDE");
    assert.equal(denied.length,1);
    assert.equal(denied[0].details.page,a.page);
    assert.equal(denied[0].details.side,"B");
    assert.ok(denied[0].details.error.message);
  });
  await t.test(adapter+" R01 protocol versions, grammar and zero file reads before validation",async()=>{
    const sentinel=join(roots[0],"probe.v");
    await utimes(sentinel,0,1);
    const args=["aig","open",sentinel,sentinel];
    const version=await s.admin("command",{version:999,id:"bad-version",argv:["open",sentinel],page:a.page});
    assert.equal(version.error.code,"PROTOCOL_VERSION");
    assert.equal((await command("bad-args",...args)).error.code,"INVALID_ARGUMENT");
    assert.equal((await command("bad-side-file","aig","add",sentinel,"--side","A")).error.code,"INVALID_SIDE");
    assert.equal((await command("bad-side-module","module","open","top","--side","B")).error.code,"INVALID_SIDE");
    assert.equal((await command("bad-side-catalogue","commands","--side","B")).error.code,"INVALID_SIDE");
    assert.equal((await poll()).job,undefined);
    assert.equal((await stat(sentinel)).atimeMs,0);
    await readFile(sentinel);
    assert.ok((await stat(sentinel)).atimeMs>0,"fixture filesystem must record a real read");
    const rows=(await command("catalogue","commands")).result;
    assert.equal(new Set(rows.map(row=>row.name)).size,180);
    assert.ok(rows.every(row=>row.syntax && row.capability && row.target && row.completion));
  });
  await t.test(adapter+" R03/R04 queue, cancellation at receive and commit gate, deduplication and unknown outcome",async()=>{
    assert.equal((await s.admin("command",{argv:["module","list"]})).error.code,"PAGE_REQUIRED");
    assert.equal((await command("before-delivery","module","list")).status,"queued");
    await receipt("before-delivery","queued");
    await job("cancel","before-delivery");
    assert.equal((await poll()).job,undefined);
    await command("before-grant","module","list");
    assert.equal((await poll()).job.id,"before-grant");
    await receipt("before-grant","delivered");
    await job("cancel","before-grant");
    assert.equal((await grant("before-grant")).granted,false);
    await receipt("before-grant","cancelled");
    await command("once","module","list");
    assert.equal((await poll()).job.id,"once");
    assert.equal((await grant("once")).granted,true);
    await receipt("once","executing");
    const committed=await ack("once",{modules:["top"]});
    assert.equal(committed.status,"committed");
    assert.deepEqual((await command("once","module","list")).result,committed.result);
    assert.equal((await poll()).job,undefined);
    assert.equal((await command("once","module","open","top")).error.code,"REQUEST_CONFLICT");
    assert.equal((await s.page(b,"status",{id:"once"})).error.code,"ACCESS_DENIED");
    // Lost acknowledgement after the commit gate: the original request cannot be replayed on b.
    await s.admin("command",{id:"lost",argv:["module","list"],page:b.page});
    await s.page(b,"poll"); await s.page(b,"grant",{id:"lost"}); await s.page(b,"leave");
    await receipt("lost","unknown");
    assert.equal((await poll()).job,undefined);
  });
  await t.test(adapter+" R04 retries of page reservations and renames preserve the original receipt",async()=>{
    const mutate=(id,...words)=>command("transport-"+id,...words,"--request-id",id);
    const reserve=()=>mutate("reserved-page","page","new","--name","engineering");
    const [first,retried]=await Promise.all([reserve(),reserve()]);
    assert.equal(first.status,"committed");
    assert.equal(first.requestId,"reserved-page");
    assert.deepEqual(retried,first);
    assert.deepEqual(await job("status","reserved-page"),first);
    assert.equal((await mutate("reserved-page","page","new")).error.code,"REQUEST_CONFLICT");

    await command("initial-label","page","rename",a.page,"before");
    const rename=()=>mutate("rename-page","page","rename","before","after");
    const renamed=await rename();
    assert.equal(renamed.result.name,"after");
    assert.deepEqual(await rename(),renamed);
    assert.equal((await mutate("rename-page","page","rename",a.page,"unused")).error.code,"REQUEST_CONFLICT");
    const collision=()=>mutate("duplicate-name","page","new","--name","after");
    const rejected=await collision();
    assert.equal(rejected.error.code,"NAME_CONFLICT");
    assert.equal(rejected.requestId,"duplicate-name");
    await command("free-label","page","rename",a.page,"now-free");
    assert.deepEqual(await collision(),rejected);
    assert.deepEqual(await job("status","duplicate-name"),rejected);
    assert.deepEqual(await rename(),renamed);
    assert.equal((await command("current-label","page","info",a.page)).result.name,"now-free");

    const logs=join(dir,"logs-"+adapter);
    const errorFiles=(await readdir(logs)).filter(name=>name.endsWith(".error.jsonl"));
    const entries=(await Promise.all(errorFiles.map(name=>readFile(join(logs,name),"utf8"))))
      .flatMap(data=>data.trim().split("\n").filter(Boolean).map(line=>JSON.parse(line)))
      .filter(row=>row.details?.requestId==="duplicate-name");
    assert.equal(entries.length,1);
    assert.equal(entries[0].details.operation,"page new");
    assert.equal(entries[0].details.code,"NAME_CONFLICT");
    assert.ok(entries[0].details.error.message);
  });
  await t.test(adapter+" R11 root navigation, pagination, directory-local prefix completion and page-bound access",async()=>{
    assert.deepEqual((await command("roots","fs","roots")).result,roots);
    const first=await s.page(a,"list",{path:roots[1],filter:"sample",number:1});
    const last=await s.page(a,"list",{path:roots[1],filter:"sample",number:2});
    assert.equal(first.total,103);assert.equal(first.entries.length,100);assert.equal(last.entries.length,3);
    assert.equal(new Set([...first.entries,...last.entries].map(f=>f.name)).size,103);
    const child=await s.page(a,"list",{path:join(roots[1],"child")});
    const parent=await s.page(a,"list",{path:join(child.path,"..")});
    assert.equal(parent.path,roots[1]);
    const nested=join(roots[1],"child");
    await utimes(nested,0,1);
    const complete=(await command("complete","fs","complete",join(roots[1],"prefix-"))).result;
    assert.equal(complete.path,roots[1]);
    assert.deepEqual(complete.entries.map(f=>f.name),["prefix-top.v"]);
    assert.equal((await stat(nested)).atimeMs,0,"completion enumerates the current level");
    const outside=await s.page(a,"list",{path:dir});assert.equal(outside.error.code,"ACCESS_DENIED");
    const root=await s.page(a,"list",{path:roots[0]});
    const unreadable=root.entries.find(f=>f.name==="unreadable.v");
    assert.ok(unreadable?.handle);
    const denied=await s.page(a,"import",{argv:["design","open",unreadable.handle]});
    assert.equal(denied.status,"failed");assert.equal(denied.error.code,"EACCES");
    assert.ok(!JSON.stringify(denied).includes("unreadable-private-marker"));
    assert.ok(!root.entries.some(f=>join(roots[0],f.name)===s.stateFile));
    const handle=root.entries.find(f=>f.name==="probe.v")?.handle;
    assert.match(handle,/^ngb-file:/);
    const other=await s.register();
    const foreign=await s.page(other,"import",{argv:["design","open",handle]});
    assert.equal(foreign.error.code,"ACCESS_DENIED");
    assert.ok(!JSON.stringify(foreign).includes("probe-private-marker"));
    await s.page(other,"leave");
  });
  await t.test(adapter+" R13 kernel-injected partial SVG write preserves the previous output and removes temporary file",async()=>{
    const path=join(dir,adapter+".svg");
    const old=Buffer.from("<svg><title>original</title></svg>");
    await writeFile(path,old);
    await command("large-export","svg","export",path,"--overwrite");
    assert.equal((await poll()).job.id,"large-export");
    assert.equal((await grant("large-export")).granted,true);
    const failed=await ack("large-export",{text:"<svg>"+("x".repeat(cap*2))+"</svg>"});
    assert.equal(failed.status,"failed");assert.ok(failed.error?.code);
    assert.deepEqual(await readFile(path),old);
    assert.ok(!(await readdir(dir)).some(p=>p.startsWith(".ngb-export-")));
    await command("retry-export","svg","export",path,"--overwrite");
    assert.equal((await poll()).job.id,"retry-export");
    await grant("retry-export");
    const fresh="<svg><title>new</title></svg>";
    const r=await ack("retry-export",{text:fresh});assert.equal(r.status,"committed");
    assert.equal(await readFile(path,"utf8"),fresh);
  });
  await t.test(adapter+" R13 explicit output named download writes a server file",async()=>{
    const cwd=join(dir,adapter+"-export");
    await mkdir(cwd);
    const output=join(cwd,"download");
    const submit=id=>s.admin("command",{id,page:a.page,cwd,argv:["svg","export","--out","download"]});
    const svg="<svg><title>download</title></svg>";
    for(const id of ["named-download","existing-download"]){
      assert.equal((await submit(id)).status,"queued");
      assert.equal((await poll()).job.opts.out,"download");
      await grant(id);
      const reply=await ack(id,{text:svg});
      if(id==="named-download") {
        assert.equal(reply.status,"committed");
        assert.deepEqual(reply.result,{path:output,bytes:Buffer.byteLength(svg)});
      } else {
        assert.equal(reply.status,"failed");
        assert.equal(reply.error.code,"EEXIST");
      }
      assert.equal(await readFile(output,"utf8"),svg);
    }
  });
  await s.page(a,"leave");
}

test("Linux Node and standalone ELF workbench protocol",{timeout:90000},async t=>{
  assert.equal(process.platform,"linux","run on the SSH server");
  const dir=await mkdtemp(join(tmpdir(),"ngb-protocol-"));
  const roots=[join(dir,"input"),join(dir,"second")];
  const running=[];
  try{
    await Promise.all([...roots,join(dir,"deploy")].map(p=>mkdir(p)));
    await copyFile(binary,join(dir,"deploy/ngb"));await chmod(join(dir,"deploy/ngb"),0o700);
    await writeFile(join(roots[0],"probe.v"),"// probe-private-marker");
    await writeFile(join(roots[0],"unreadable.v"),"unreadable-private-marker",{mode:0});
    await mkdir(join(roots[1],"child"));
    await writeFile(join(roots[1],"child","prefix-hidden.v"),"");
    for(const name of ["prefix-top.v","ignore-prefix-embedded.v"])await writeFile(join(roots[1],name),"");
    await Promise.all(Array.from({length:103},(_,i)=>writeFile(join(roots[1],"sample"+String(i).padStart(3,"0")),"")));
    for(const adapter of ["npm","elf"]) running.push(await start(adapter,dir,roots));
    await check("npm",running[0],dir,roots,t);
    await check("elf",running[1],dir,roots,t);
    for(const adapter of ["npm","elf"]){
      await t.test(adapter+" R02/R06 auto state identifies its own interactive service for status and stop",async()=>{
        const session=await start(adapter,dir,roots,true);
        try{
          assert.match((await session.status()).stdout,/status=running/);
          await session.stop();
        }finally{await session.cleanup();}
      });
    }
    await t.test("R02/R06 targeted stop releases state, control socket and port while sibling stays reachable",async()=>{
      await running[0].stop();
      assert.equal((await running[1].admin("command",{argv:["pages"]})).status,"committed");
      await running[1].stop();
    });
  }finally{
    await Promise.all(running.map(s=>s.cleanup()));
    await rm(dir,{recursive:true,force:true});
  }
});
