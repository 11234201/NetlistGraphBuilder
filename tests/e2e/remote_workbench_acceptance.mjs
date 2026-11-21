import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {readFile, writeFile} from "node:fs/promises";
import {createHash, randomInt} from "node:crypto";
import {once} from "node:events";
import {verifyCollectionViews} from "./remote_workbench_views.mjs";
const {chromium} = await import(process.env.NGB_PLAYWRIGHT_MODULE || "playwright");
const host=process.env.NGB_SSH_HOST, root=process.env.NGB_REMOTE_ROOT;
if(!host || !root) throw new Error("Set NGB_SSH_HOST and NGB_REMOTE_ROOT to a prepared checkout with build/native/ngb");
const quote=s => "'" + String(s).replaceAll("'","'\\''") + "'";
const shell=args => args.map(quote).join(" ");
const delay=ms => new Promise(r => setTimeout(r,ms));
async function ssh(args, allow=false) {
  const task=spawn("ssh",[host,"cd "+quote(root)+" && "+shell(args)],{windowsHide:true});
  const chunks=[],errors=[];
  task.stdout.on("data",v=>chunks.push(v));task.stderr.on("data",v=>errors.push(v));task.stdin.end();
  const [exit]=await once(task,"exit");const text=Buffer.concat(chunks).toString().trim();
  if(exit!==0&&!allow)throw new Error(Buffer.concat(errors).toString()+" "+text);
  return text;
}
async function until(fn,label,timeout=20000) {
  const end=Date.now()+timeout;let last;
  do{try{last=await fn();if(last)return last;}catch(e){last=e;}await delay(90);}while(Date.now()<end);
  throw new Error("Timed out "+label+" "+String(last));
}
const adapters=(process.env.NGB_ADAPTERS||"npm,elf").split(",");
const dir=await ssh(["node","tests/e2e/remote_workbench_fixture.mjs",...(adapters.includes("elf")?[]:["--no-elf"])]);
const browser=await chromium.launch({headless:true,executablePath:process.env.NGB_CHROME_BINARY,args:["--no-first-run"]});
const report={fixture:dir,runs:[]};
async function run(adapter) {
  const native=adapter==="elf", state=dir+"/"+adapter+".state", inp=dir+"/inputs", bin=dir+"/deploy/ngb";
  const remotePort=randomInt(20000,30000),localPort=randomInt(31000,42000);
  const python=adapter==="python";
  const cmd=native?["env","PATH=/nonexistent",bin]:python?["env","PATH=/nonexistent","/usr/bin/python3",root+"/tools/serve.py"]:["node",root+"/tools/serve.mjs"];
  const start=native||python?[...cmd,"start"]:["npm","start","--"];
  const args=["--port",String(remotePort),"--browse-root",inp,"--browse-root",dir+"/second","--state-file",state,"--no-open"];
  // ssh started from a piped CI controller otherwise advertises TERM=dumb; model a user terminal.
  const term=spawn("ssh",["-tt","-o","ExitOnForwardFailure=yes","-L","127.0.0.1:"+localPort+":127.0.0.1:"+remotePort,host,"cd "+quote(root)+" && exec "+shell(["env","TERM=xterm-256color",...start,...args])],{windowsHide:true});
  let output="";const append=data=>{output+=data.toString();};term.stdout.on("data",append);term.stderr.on("data",append);
  const clean=s=>s.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,"").replace(/\r/g,"");
  const ctx=await browser.newContext({viewport:{width:1600,height:1000},acceptDownloads:true});
  await ctx.addInitScript(() => {
    window.aigWorkerCalls = 0;
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (...args) {
      if (typeof args[0]?.dot === "string" && args[0].format) {
        window.aigWorkerCalls++;
        if (window.failNextAigLayout) {
          window.failNextAigLayout = false;
          throw new Error("Acceptance fixture: layout unavailable");
        }
      }
      return send.apply(this, args);
    };
  });
  const run={adapter,remotePort,localPort,steps:[]};report.runs.push(run);
  const step=(id,data)=>{run.steps.push({id,...data});console.log(adapter,id,JSON.stringify(data));};
  const cmdRun=async(...argv)=>JSON.parse(await ssh([...cmd,"cmd","--state-file",state,...argv],true));
  async function ok(...argv){const r=await cmdRun(...argv);assert.equal(r.status,"committed",JSON.stringify(r));return r.result;}
  async function repl(line,tabPath){
    const pos=output.length;
    if (tabPath) {
      term.stdin.write(line);
      await until(()=>clean(output.slice(pos)).includes(line),"echo before pressing Tab");
      term.stdin.write("\t");
      try { await until(()=>clean(output.slice(pos)).includes(tabPath),"Tab completion for "+line,5000); }
      catch (error) { throw new Error(error.message+"; terminal output: "+JSON.stringify(clean(output.slice(pos)).slice(-300))); }
      term.stdin.write("\n");
    } else term.stdin.write(line+"\n");
    return until(()=>{for(const line of clean(output.slice(pos)).split("\n")){const i=line.indexOf('{"');if(i>=0)try{const v=JSON.parse(line.slice(i));if(v.status)return v;}catch{}}},"terminal "+line);
  }
  try{
    const ready=await until(()=>{const x=clean(output).split("\n").find(l=>l.startsWith('{"event":"ready"'));return x&&JSON.parse(x);},"ready");
    const url=new URL(ready.pairUrl);url.port=String(localPort);
    const net=await ctx.newPage(), graph=await ctx.newPage();
    for(const p of [net,graph])p.on("pageerror",e=>console.error("pageerror",e.message));
    await Promise.all([net.goto(url.href),graph.goto(url.href)]);
    const id=p=>p.locator("#remotePageLabel").innerText({timeout:25000}).then(s=>s.trim().split(" ")[0]);
    await Promise.all([net,graph].map(p=>p.locator("#remotePageLabel").waitFor({state:"visible",timeout:30000})));
    const pn=await id(net),pg=await id(graph);assert.notEqual(pn,pg);
    await ok("page","rename",pn,"netlist");await ok("page","rename",pg,"graphs");
    if(process.env.NGB_CHECK_ARCHIVE==="only") {
      await ok("--page",pg,"aig","open",inp+"/base/top.blif");
      await ok("--page",pg,"aig","add",inp+"/eco/top.blif",inp+"/shared_cone.dot");
      const [base,eco]=await ok("--page",pg,"module","list");
      step("R09/R10",await verifyCollectionViews({graph,base,eco,ok,inputs:inp,until}));
      return;
    }
    const pages=await repl("pages");assert.deepEqual(pages.result.map(p=>p.id).sort(),[pn,pg].sort());
    const unselected = await cmdRun("module","list");
    assert.equal(unselected.error.code,"PAGE_REQUIRED");
    assert.deepEqual(unselected.error.candidates.sort(),[pn,pg].sort());
    // An opener copies the tab's sessionStorage, just as duplicating a tab does.
    const popup = net.waitForEvent("popup");
    await net.evaluate(() => { window.open(location.href,"_blank"); });
    const duplicate = await popup;
    await duplicate.locator("#remotePageLabel").waitFor({state:"visible"});
    const copyId = await id(duplicate);
    assert.ok(copyId !== pn && copyId !== pg);
    await duplicate.close();
    await until(async () => (await ok("pages")).length === 2,"close duplicate");
    const completed=await repl("fs ls "+inp+"/bas",inp+"/base/");
    assert.equal(completed.status,"committed");
    assert.deepEqual(completed.result.entries.map(f=>f.name),["top.blif"]);
    step("A1",{pn,pg,duplicate:copyId,unselected:unselected.error.code,tabCompleted:"base/"});
    async function pick(page,action,path,submit=true){
      const button=page.locator("#serverFiles");
      for(const menu of await button.locator("xpath=ancestor::details").all())if(!await menu.evaluate(e=>e.open))await menu.locator(":scope > summary").click();
      await button.click();const dlg=page.locator("dialog[open]").filter({has:page.locator("[data-action]")});
      await dlg.locator("[data-action]").selectOption(action);
      for(const sub of path.split("/").slice(0,-1))await dlg.getByRole("button",{name:sub+"/",exact:true}).click();
      await dlg.getByLabel(path.split("/").at(-1),{exact:true}).check();
      if(submit) await dlg.locator("[data-submit]").click(); else await dlg.getByRole("button",{name:"Cancel",exact:true}).click();
      try { await dlg.waitFor({state:"hidden"}); }
      catch (error) { throw new Error(action+" "+path+" picker: "+await dlg.locator("[data-status]").innerText(),{cause:error}); }
    }
    const surface=p=>p.evaluate(()=>({source:document.querySelector("#moduleHierarchyCurrent")?.textContent,
      selection:document.querySelector("#schematicMount .is-selected")?.getAttribute("data-node-id")||null,
      transform:document.querySelector("#schematicMount svg g")?.getAttribute("transform")}));
    const initial=await surface(graph);
    const beforeCancel=await surface(net);
    let pickerSubmissions=0;
    const countImports=req=>{
      if(req.method()==="POST" && new URL(req.url()).pathname==="/__ngb/workbench" && req.postDataJSON()?.op==="import")pickerSubmissions++;
    };
    net.on("request",countImports);
    await pick(net,"design open","top.v",false);
    assert.equal(pickerSubmissions,0);net.off("request",countImports);
    assert.deepEqual(await surface(net),beforeCancel);
    await pick(net,"design open","top.v");
    await until(async()=>JSON.stringify((await ok("--page",pn,"module","list")).map(x=>x.name))==='["top"]',"top");
    await pick(net,"timing open","T1.rpt");
    await until(async()=>(await ok("--page",pn,"timing","show","a"))[0]?.slack===0.10,"first Slack");
    assert.equal((await repl("use "+pn)).page,pn);
    assert.equal((await repl("add "+inp+"/extra.v")).status,"committed");
    const tcl=await ssh(["tclsh","tests/e2e/remote_workbench_acceptance.tcl",native?"elf":python?"python":"node",
      native?bin:root+(python?"/tools/serve.py":"/tools/serve.mjs"),state,pn,inp+"/中文 timing/T2.rpt"]);
    assert.ok(tcl.includes("TCL_PASS "+pn));
    await ok("--page",pn,"module","open","top");
    const replSelection = (await repl("selection get")).result.selection;
    const cliSelection = (await ok("--page",pn,"selection","get")).selection;
    assert.equal(cliSelection.id,"input:a");
    assert.deepEqual(replSelection,cliSelection);
    for (const words of [["liberty","status"],["compare","status"],["path","draft"],["analysis","status"]]) {
      assert.deepEqual((await repl(words.join(" "))).result,await ok("--page",pn,...words));
    }
    const checkNet=async()=>{const mods=(await ok("--page",pn,"module","list")).map(x=>x.name).sort();
      const slack=[];for(const point of ["a","y"])slack.push((await ok("--page",pn,"timing","show",point))[0]?.slack);
      assert.deepEqual(mods,["extra","top"]);assert.deepEqual(slack,[0.10,-0.05]);return {mods,slack};};
    assert.deepEqual(await surface(graph),initial);step("A2",{...await checkNet(),tcl});
    await pick(graph,"aig open","base/top.blif");await graph.locator("#schematicMount [data-aig-node]").first().waitFor();
    const glist=()=>ok("--page",pg,"module","list");
    const base=(await glist())[0];
    const shapeBefore = await graph.locator("#schematicMount [data-aig-node]").first().elementHandle();
    await shapeBefore.focus(); await shapeBefore.press("Enter");
    const callsBefore = await graph.evaluate(() => window.aigWorkerCalls);
    assert.ok(callsBefore > 0,"Graphviz completed initial graph layout");
    await pick(graph,"aig add","eco/top.blif");
    const two=await until(async()=>{const a=await glist();return a.length===2&&a;},"two graphs");
    assert.equal(two.find(g=>g.active).id,base.id);const eco=two.find(g=>g.id!==base.id);
    const addLayouts = await graph.evaluate(() => window.aigWorkerCalls) - callsBefore;
    assert.equal(addLayouts,0);
    assert.equal(await shapeBefore.evaluate(shape=>shape.isConnected),true);
    await shapeBefore.dispose();
    const ambiguous=await cmdRun("--page",pg,"module","open","top.blif");assert.equal(ambiguous.error?.code,"AMBIGUOUS_GRAPH");assert.equal(ambiguous.error.candidates.length,2);
    const go=g=>ok("--page",pg,"module","open",g.id);
    await graph.evaluate(()=>{ window.failNextAigLayout=true; });
    const failedLayout = await cmdRun("--page",pg,"module","open",eco.id);
    assert.equal(failedLayout.status,"failed");
    assert.equal((await glist()).find(g=>g.active).id,base.id);
    await ok("--page",pg,"files","browse","--action","aig add","--dir",inp);
    const stalePicker=graph.locator("dialog[open]").filter({has:graph.locator("[data-action]")});
    await stalePicker.getByLabel("shared_cone.dot",{exact:true}).check();
    await go(eco);
    await stalePicker.locator("[data-submit]").click();
    await until(async () => (await stalePicker.locator("[data-status]").textContent()).includes("target document changed"), "stale picker feedback");
    await stalePicker.locator("[data-cancel]").click();
    const graphInfo=await ok("--page",pg,"design","info");
    assert.deepEqual([graphInfo.graphCount,graphInfo.graphId],[2,eco.id]);
    assert.ok((await ok("--page",pg,"search","find","z_eco")).length);
    assert.equal((await ok("--page",pg,"search","find","n4")).length,0);
    await graph.locator("#aigGraphSelect").selectOption(base.id);
    await until(async () => (await glist()).find(g=>g.active).id === base.id,"switch back using graph picker");
    assert.ok((await ok("--page",pg,"search","find","n4")).length);
    assert.equal((await ok("--page",pg,"search","find","z_eco")).length,0);
    step("A3",{graphs:two,roles:{base:base.id,eco:eco.id},addLayouts,failedLayout:failedLayout.status,ambiguous:ambiguous.error.code});
    const fail=await cmdRun("--request-id","bad-batch","--page",pg,"aig","add",inp+"/shared_cone.dot",inp+"/broken.blif");
    assert.equal(fail.status,"failed");assert.equal(fail.error.files.find(f=>f.name==="broken.blif").status,"failed");
    assert.equal((await glist()).length,2);assert.equal((await glist()).find(g=>g.active).id,base.id);
    const logDownload=graph.waitForEvent("download");
    await graph.locator("#exportProcessLogButton").evaluate(button=>button.click());
    const logText=await readFile(await (await logDownload).path(),"utf8");
    const logs=logText.trim().split(/\r?\n/).map(row=>JSON.parse(row));
    const stale=logs.filter(row=>row.details?.operation==="files.browse" && row.details.code==="STALE_DOCUMENT");
    assert.equal(stale.length,1);assert.equal(stale[0].details.page,pg);
    assert.equal(stale[0].details.graphId,base.id);assert.ok(stale[0].details.error.stack);
    const staleDetail=graph.locator("#processLogList li").filter({hasText:stale[0].message}).first();
    await staleDetail.locator("summary").evaluate(el=>el.click());
    assert.match(await staleDetail.locator("pre").textContent(),/STALE_DOCUMENT/);
    const matched=logs.filter(row=>row.details?.requestId==="bad-batch" && row.details.operation==="aig add");
    assert.equal(matched.length,1);assert.equal(matched[0].details.page,pg);
    assert.ok(matched[0].details.error.stack);
    const detail=graph.locator("#processLogList li").filter({hasText:matched[0].message}).first();
    await detail.locator("summary").evaluate(el=>el.click());
    assert.match(await detail.locator("pre").textContent(),/bad-batch/);
    const add=["--page",pg,"--request-id","add-cone","aig","add",inp+"/shared_cone.dot"];
    let acknowledgements=0, inputDeliveries=0;
    const interceptAck=async route=>{
      const message=route.request().postDataJSON();
      if(message?.op==="inputs" && message.id==="add-cone" && ++inputDeliveries===1) {
        await route.abort("failed");
      } else if(message?.op==="ack" && message.id==="add-cone" && ++acknowledgements===1) {
        await route.abort("failed");
      } else await route.continue();
    };
    await graph.route("**/__ngb/workbench",interceptAck);
    let once;
    try {
      once=await ok(...add);
      assert.ok(inputDeliveries>=2,"browser retried the incomplete input transfer");
      assert.ok(acknowledgements>=2,"browser retried the dropped acknowledgement");
    } finally { await graph.unroute("**/__ngb/workbench",interceptAck); }
    assert.deepEqual(await ok(...add),once);assert.equal((await glist()).length,3);
    const collision=await cmdRun(...add.slice(0,-1),inp+"/base/top.blif");assert.equal(collision.error.code,"REQUEST_CONFLICT");
    step("A4",{files:fail.error.files,once,graphCount:3,conflict:collision.error.code,inputDeliveries,acknowledgements,loggedErrors:matched.length});
    if(process.env.NGB_CHECK_ARCHIVE==="1") {
      const result=await verifyCollectionViews({graph,base,eco,ok,inputs:inp,until});
      step("R09/R10",result);
    }
    const snapshot=()=>graph.evaluate(()=>JSON.parse(sessionStorage.getItem("ngb.aig-collection.v1")));
    const views={};
    for(const [g,i] of [[base,0],[eco,1]]){
      await go(g);
      const shape=graph.locator("#schematicMount [data-domain-object][data-aig-node]").nth(i);
      await shape.focus();await shape.press("Enter");
      const bounds=await shape.boundingBox();await graph.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await graph.mouse.wheel(0,i?-180:120);
      await delay(450);const view=(await snapshot()).records.find(r=>r.id===g.id).view;
      assert.ok(view.selectedId);views[g.id]={selectedId:view.selectedId,viewport:view.viewport};
    }
    assert.notDeepEqual(views[base.id].viewport,views[eco.id].viewport);
    await graph.reload();await graph.locator("#remotePageLabel").waitFor({state:"visible"});
    assert.equal(await id(graph),pg);assert.equal((await glist()).find(g=>g.active).id,eco.id);
    for(const g of [base,eco]){await go(g);const view=(await snapshot()).records.find(r=>r.id===g.id).view;
      assert.equal(view.selectedId,views[g.id].selectedId);
      for (const k of ["scale","x","y"]) assert.ok(Math.abs(view.viewport[k]-views[g.id].viewport[k]) < 1e-8, "Restored viewport "+g.id+" "+k);
      const inspected = graph.locator("#domainInspector [data-aig-inspected-id]").first();
      await inspected.waitFor();
      assert.equal(await inspected.getAttribute("data-aig-inspected-id"),views[g.id].selectedId);}
    const svg=dir+"/"+adapter+".svg";const first=await ok("--page",pn,"svg","export",svg);assert.ok(first.bytes>100);
    assert.equal((await cmdRun("--page",pn,"svg","export",svg)).error.code,"EEXIST");
    const download=net.waitForEvent("download");
    const downloaded = await ok("--page",pn,"svg","export","--download");
    assert.equal(downloaded.downloadTriggered,true);
    const localFile=await download;
    assert.ok(localFile.suggestedFilename().endsWith(".svg"));
    const svgBytes=await readFile(await localFile.path());
    const hash=createHash("sha256").update(svgBytes).digest("hex");
    const remoteHash=(await ssh(["sha256sum",svg])).split(" ")[0];
    assert.equal(remoteHash,hash);
    const designVisible = await net.evaluate(markup => {
      const svgDoc = new DOMParser().parseFromString(markup,"image/svg+xml");
      return svgDoc.documentElement.localName === "svg" && !svgDoc.querySelector("parsererror") && svgDoc.documentElement.textContent.includes("u_buf");
    },svgBytes.toString("utf8"));
    assert.equal(designVisible,true,"Both exports contain the top module's buffer");
    assert.equal((await repl("use "+pg)).page,pg);await graph.close();
    await until(async()=>(await ok("pages")).length===1,"disconnect");
    const closed=await repl("add "+inp+"/shared_cone.dot");assert.equal(closed.error.code,"PAGE_UNAVAILABLE");
    const retained = await checkNet();
    await ok("--page",pn,"design","open",inp+"/extra.v");
    const reopened=(await ok("--page",pn,"module","list")).map(m=>m.name);
    assert.deepEqual(reopened,["extra"]);
    const mixed=await cmdRun("--page",pn,"files","import",inp+"/top.v",inp+"/broken.blif",inp+"/T1.rpt");
    assert.equal(mixed.status,"partial",JSON.stringify(mixed));
    const mixedFiles=mixed.result.files.map(({name,status})=>({name,status}));
    assert.deepEqual(mixedFiles,[
      {name:"top.v",status:"committed"},{name:"broken.blif",status:"failed"},{name:"T1.rpt",status:"committed"}]);
    const afterMixed=(await ok("--page",pn,"timing","show","a"))[0].slack;
    assert.equal(afterMixed,0.10);
    step("A5",{views,closed:closed.error.code,...retained,reopened,svgBytes:first.bytes,svgSha256:hash,mixedFiles,afterMixed});
  } finally {
    await ctx.close();term.stdin.write("quit\n");await Promise.race([once(term,"exit"),delay(2500)]);term.kill();
    await ssh([...cmd,"stop","--state-file",state],true).catch(()=>{});
  }
}
try{
  for(const adapter of adapters) await run(adapter);
  if(report.runs.length>=2 && process.env.NGB_CHECK_ARCHIVE!=="only") {
    function businessResults(result) {
      const byId=Object.fromEntries(result.steps.map(s=>[s.id,s]));
      const {A1,A2,A3,A4,A5}=byId;
      const graphs={};
      for(const [role,id] of Object.entries(A3.roles)) {
        const graph=A3.graphs.find(item=>item.id===id);
        graphs[role]={source:graph.name,format:graph.format,fingerprint:graph.fingerprint,
          active:graph.active,selected:A5.views[id].selectedId};
      }
      return {targetRequired:A1.unselected,modules:A2.mods,slack:A2.slack,graphs,
        ambiguous:A3.ambiguous,addLayouts:A3.addLayouts,failedLayout:A3.failedLayout,
        files:A4.files,conflict:A4.conflict,added:A4.once.added.map(({name,format,fingerprint})=>({name,format,fingerprint})),
        graphCount:A4.graphCount,closed:A5.closed,reopened:A5.reopened,retainedAfterClose:[A5.mods,A5.slack]};
    }
    const [reference,...others]=report.runs.map(businessResults);
    for (const other of others) assert.deepEqual(other,reference);
    report.A6="passed";console.log("A6 passed");
  }
}finally{
  await browser.close();
  if(process.env.NGB_ACCEPTANCE_REPORT)await writeFile(process.env.NGB_ACCEPTANCE_REPORT,JSON.stringify(report,null,2));
}
