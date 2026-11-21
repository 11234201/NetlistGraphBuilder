// Run against an actual release ZIP, with only the EXE and its adjacent runtime available to the product.
import assert from "node:assert/strict";
import {execFile, spawn} from "node:child_process";
import {once} from "node:events";
import {access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, unlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {createInterface} from "node:readline";
import {promisify} from "node:util";
import {fileURLToPath} from "node:url";

const exec = promisify(execFile);
assert.equal(process.platform, "win32", "Run against the Windows release");
const root = fileURLToPath(new URL("../..",import.meta.url));
const archive = resolve(process.argv[2] || process.env.NGB_WINDOWS_ZIP || "");
assert.ok((await stat(archive)).isFile(), "Pass the built release ZIP");
const scratch = await mkdtemp(join(tmpdir(),"ngb-release-"));
let browser, service;
try {
  await exec("powershell.exe", ["-NoProfile","-NonInteractive","-Command",
    "Expand-Archive -LiteralPath $env:NGB_TEST_ZIP -DestinationPath $env:NGB_TEST_DEST"],
    {windowsHide:true,env:{...process.env,NGB_TEST_ZIP:archive,NGB_TEST_DEST:scratch}});
  const [folder] = await readdir(scratch);
  const pkg = join(scratch,folder);
  const exe = join(pkg,"NetlistGraphBuilder.exe");
  assert.match(await readFile(join(pkg,"PYTHON-LICENSE.txt"),"utf8"),/Python Software Foundation/);
  const inputs = join(scratch,"设计 files");
  await mkdir(inputs);
  const noPath = join(scratch,"empty-path");
  await mkdir(noPath);
  const env = {...process.env, PATH:noPath, NGB_LOG_DIR:join(scratch,"logs"), PYTHONHOME:noPath, PYTHONPATH:noPath};
  // Windows environment keys are case-insensitive; Node preserves the first spelling it sees.
  for (const key of Object.keys(env)) if (key !== "PATH" && key.toUpperCase() === "PATH") delete env[key];
  const state = join(inputs,"session.state");
  const base = join(inputs,"base graph.blif"), eco = join(inputs,"eco graph.blif"), design = join(inputs,"网表 one.v");
  await copyFile(join(root,"examples/aig_mapped_names.blif"),base);
  await writeFile(eco,".model eco\n.inputs n0 n1\n.outputs eco_y\n.names n0 n1 eco_y\n11 1\n.end\n");
  await writeFile(design,"module top(input a, output y); BUF u0 (.A(a),.Y(y)); endmodule");
  service = spawn(exe,["start","--port","0","--state-file",state,"--browse-root",inputs,"--no-open","--no-interactive"],{
    cwd:inputs,env,stdio:["ignore","pipe","pipe"],windowsHide:true});
  let stderr = "";
  service.stderr.on("data",data=>{stderr=(stderr+data).slice(-4000);});
  const exit = once(service,"close");
  const reader = createInterface({input:service.stdout});
  const ready = await Promise.race([
    once(reader,"line").then(([line])=>JSON.parse(line)),
    exit.then(([code])=>{throw new Error("Release exited before ready: "+code+" "+stderr);}),
    new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error("Timeout waiting for ready")),20000);timer.unref();})
  ]);
  const settings = {cwd:inputs,env,windowsHide:true,timeout:30000,maxBuffer:4*1024*1024};
  const cli = async (...args) => {
    try { return JSON.parse((await exec(exe,["cmd","--state-file",state,...args],settings)).stdout); }
    catch (error) { if (error.stdout) return JSON.parse(error.stdout); throw error; }
  };
  const ok = async (...args) => {
    const reply = await cli(...args);
    assert.equal(reply.status,"committed",JSON.stringify(reply));
    return reply.result;
  };
  assert.equal(ready.event,"ready");
  assert.match((await exec(exe,["status","--state-file",state],settings)).stdout,/status=running/);
  const listing = await ok("fs","ls",inputs);
  assert.ok(listing.entries.some(entry=>entry.name === "网表 one.v"));
  assert.ok(!listing.entries.some(entry=>entry.name === "session.state"));
  const {chromium} = await import(process.env.NGB_PLAYWRIGHT_MODULE || "playwright");
  browser = await chromium.launch({headless:true,executablePath:process.env.NGB_CHROME_BINARY});
  const context = await browser.newContext();
  const origin = new URL(ready.url).origin;
  const external = [];
  const diagnostics = [];
  context.on("weberror",event=>diagnostics.push(event.error().message));
  context.on("response",response=>{
    if (response.status() >= 400) diagnostics.push(response.status()+" "+new URL(response.url()).pathname);
  });
  context.on("request",req=>{
    const url = new URL(req.url());
    if (["http:","https:"].includes(url.protocol) && url.origin !== origin) external.push(url.href);
  });
  const [netlist,graph] = await Promise.all([context.newPage(),context.newPage()]);
  for (const page of [netlist,graph]) await page.goto(ready.pairUrl);
  const labels = await Promise.all([netlist,graph].map(async page=>{
    const label = page.locator("#remotePageLabel");
    try { await label.waitFor({state:"visible"}); }
    catch (error) { throw new Error("Page pairing failed. " + diagnostics.slice(-10).join(", "), {cause:error}); }
    return (await label.innerText()).trim().split(" ")[0];
  }));
  const [net,aig] = labels;
  assert.notEqual(net,aig);
  assert.deepEqual((await ok("pages")).map(p=>p.id).sort(),labels.slice().sort());
  await ok("--page",net,"design","open",design);
  assert.deepEqual((await ok("--page",net,"module","list")).map(m=>m.name),["top"]);
  let tclClient = false;
  if (process.env.NGB_TCLSH) {
    const report = join(inputs,"中文 timing.rpt");
    await writeFile(report,"@module top\npoint at rt slack\ny 0.30 0.25 -0.05\n");
    const test = join(root,"tests/e2e/remote_workbench_acceptance.tcl");
    const tcl = await exec(process.env.NGB_TCLSH,[test,"windows",exe,state,net,report],
      {...settings,env:{...env,NGB_TEST_TCL_BRIDGE:join(pkg,"ngb.tcl")}});
    assert.ok(tcl.stdout.includes("TCL_PASS " + net));
    assert.equal((await ok("--page",net,"timing","show","y"))[0].slack,-0.05);
    tclClient = true;
  }
  await ok("--page",aig,"aig","open",base);
  await ok("--page",aig,"aig","add",eco);
  const graphs = await ok("--page",aig,"module","list");
  assert.equal(graphs.length,2);
  assert.equal(graphs[0].active,true);
  await ok("--page",aig,"module","open",graphs[1].id);
  assert.ok((await ok("--page",aig,"search","find","eco_y")).length);
  const target = join(inputs,"导出 result.svg");
  const written = await ok("--page",net,"svg","export","--out",target);
  assert.equal((await stat(target)).size,written.bytes);
  assert.match(await readFile(target,"utf8"),/<svg\b/);
  const bad = await cli("--request-id","missing-input","--page",net,"design","add",join(inputs,"missing.v"));
  assert.equal(bad.error.code,"ENOENT");
  const duplicate = await cli("--request-id","existing-output","--page",aig,"svg","export","--out",target);
  assert.equal(duplicate.error.code,"EEXIST");
  assert.equal((await stat(target)).size,written.bytes);
  await cli("--request-id","existing-output","--page",aig,"svg","export","--out",target);
  const logFiles = (await readdir(env.NGB_LOG_DIR)).filter(name=>name.endsWith(".error.jsonl"));
  const errors = (await Promise.all(logFiles.map(name=>readFile(join(env.NGB_LOG_DIR,name),"utf8"))))
    .flatMap(data=>data.trim().split("\n").filter(Boolean).map(line=>JSON.parse(line)));
  for (const [id,event,pageId,code] of [
    ["missing-input","workbench.prepare_failed",net,"ENOENT"], ["existing-output","workbench.export_failed",aig,"EEXIST"]
  ]) {
    const matching = errors.filter(row=>row.details.requestId === id);
    assert.equal(matching.length,1,id);
    const {details} = matching[0];
    assert.equal(matching[0].event,event);
    assert.equal(details.page,pageId);
    assert.equal(details.code,code);
    assert.ok(details.documentId && details.documentVersion > 0 && details.error.stack);
    if (pageId === aig) assert.equal(details.graphId,graphs[1].id);
  }
  assert.deepEqual((await ok("--page",net,"module","list")).map(m=>m.name),["top"]);
  assert.deepEqual(external,[]);
  const version = (await readFile(join(pkg,"runtime/BUILD.txt"),"utf8")).trim();
  const stateConfig = JSON.parse(await readFile(state,"utf8"));
  assert.equal(stateConfig.pid,service.pid);
  await browser.close();
  browser = null;
  assert.match((await exec(exe,["stop","--state-file",state],settings)).stdout,/status=stopped/);
  assert.equal((await exit)[0],0);
  await assert.rejects(access(state), {code:"ENOENT"});
  await assert.rejects(fetch(ready.url));
  await unlink(base);
  await unlink(target);
  console.log(JSON.stringify({platform:"windows",runtime:version,pages:labels,graphs:graphs.map(g=>g.name),
    modules:["top"],svgBytes:written.bytes,missing:bad.error.code,tclClient,externalRequests:external.length,exitCode:0}));
} finally {
  await browser?.close();
  if (service && service.exitCode === null && service.signalCode === null) {
    const closed = once(service,"close");
    service.kill();
    await closed;
  }
  await rm(scratch,{recursive:true,force:true,maxRetries:3,retryDelay:150});
}
