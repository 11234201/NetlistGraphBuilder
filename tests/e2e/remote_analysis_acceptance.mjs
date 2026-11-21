import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

// The caller supplies the launcher-specific CLI. This suite observes each
// change independently through the real browser, including exported downloads.
export async function verifyAnalysisAcceptance({run,page,root,outputDir}) {
  const passed = new Set(), boundary = new Set();
  async function ok(...argv) {
    const result = await run(...argv);
    assert.ok(["committed","partial"].includes(result.status), argv.slice(0,2).join(" ") + ": " + JSON.stringify(result));
    passed.add(argv.slice(0,2).join(" "));
    return result.result;
  }
  async function fails(...argv) {
    const result = await run(...argv);
    assert.ok(result.error?.code,argv.slice(0,2).join(" ") + " should fail");
    boundary.add(argv.slice(0,2).join(" "));
    return result.error.code;
  }
  await ok("aig","open",root + "/examples/aig_mapped_names.blif");
  await ok("path","open");
  const find = await ok("path","find","n0");
  const start = find.entries.find(row => row.label === "n0" && row.kind.startsWith("pi"));
  const end = (await ok("path","find","n4")).entries.find(row => row.label === "n4" && row.kind.startsWith("po"));
  assert.ok(start && end);
  await ok("path","add","start",start.key);
  await ok("path","add","end",end.key);
  // Hold the real Graphviz job until the cancellation command arrives.
  await page.evaluate(() => {
    const original = Worker.prototype.postMessage;
    globalThis.restorePathWorker = () => { Worker.prototype.postMessage = original; };
    Worker.prototype.postMessage = function(message,...rest) {
      if (typeof message?.dot === "string") { globalThis.pathLayoutHeld = true; return; }
      return original.call(this,message,...rest);
    };
  });
  const pathJob = await run("path","apply","--async");
  try {
    await page.waitForFunction(() => globalThis.pathLayoutHeld,null,{timeout:10000});
    assert.equal((await ok("path","cancel")).cancelled,true);
    assert.equal((await run("job","wait",pathJob.requestId,"--timeout","5000")).status,"cancelled");
  } finally { await page.evaluate(() => globalThis.restorePathWorker()); }
  assert.equal((await ok("path","draft")).enabled,false);
  assert.deepEqual((await ok("path","draft")).ends, [end.key]);
  await ok("path","remove","end",end.key);
  await ok("path","add","end",end.key);
  await ok("path","apply");
  const report = await ok("path","report","ends");
  await ok("ui","page","path-report","1");
  assert.ok(report.entries.some(row => row.id === end.displayId));
  await fails("path","report","levels","--page-number","9999");
  assert.equal((await ok("path","report")).section,"ends");
  const distances = await ok("path","distances",start.key);
  assert.equal(distances.entries.find(row => row.id === end.displayId)?.max,2);
  assert.match(await page.locator("#pathReportBody").textContent(), /2/);
  assert.ok((await ok("path","copy",end.displayId)).text);
  await ok("path","locate",end.displayId);
  assert.ok((await ok("path","export","--out",outputDir + "/path.svg","--overwrite")).bytes > 100);
  await ok("path","enable","off");
  assert.match(await page.locator("#pathDraft").textContent(),/n0|in_96/);
  await ok("path","cancel");
  await ok("path","clear");
  assert.deepEqual((await ok("path","draft")).starts,[]);
  for (const argv of [["enable","on"],["report","ends"],["copy","missing"],["locate","missing"],["export","--download"],
                       ["apply"],["remove","end","unknown-endpoint"],["open","--side","B"]]) await fails("path",...argv);
  assert.equal((await ok("path","cancel")).cancelled,false);
  assert.equal((await ok("path","find","missing-endpoint")).entries.length,0);
  await fails("path","find","unknown","--page-number","2");
  assert.equal(await page.locator("#pathFind").inputValue(),"missing-endpoint");
  await fails("path","distances","n0");
  await fails("path","add","start","absent-endpoint");
  const objects = await ok("aig","objects","--type","all","--query","n0","--sort","name");
  assert.ok(objects.entries.some(item => item.id === start.displayId));
  await ok("aig","names","--query","in_96");
  assert.match(await page.locator("#domainNavigator").textContent(), /in_96/);
  await ok("selection","set",start.displayId);
  await ok("aig","reveal-selection");
  await ok("aig","connections","2");
  await ok("aig","overlay","critical","on");
  await ok("aig","fanout-threshold","3");
  await ok("aig","view","standard");
  await fails("aig","objects","--sort","bad");
  await fails("aig","fanout-threshold","0");
  await ok("aig","open",root + "/examples/aig_structure_demo.blif");
  const analysis = await ok("analysis","run");
  assert.equal(analysis.reconvergence,6);
  assert.equal(analysis.blocks,3);
  assert.equal((await ok("analysis","status")).status,"complete");
  const list = await ok("analysis","results","reconvergence");
  const id = list.entries[0].id;
  assert.equal((await ok("analysis","cancel")).status,"complete");
  await page.evaluate(() => {
    const send = Worker.prototype.postMessage;
    globalThis.restoreDetailWorker = () => { Worker.prototype.postMessage = send; };
    Worker.prototype.postMessage = function(message,...rest) {
      if (message?.type === "detail") { globalThis.detailHeldForCancellation = true; return; }
      return send.call(this,message,...rest);
    };
  });
  const detailJob = await run("analysis","select",id,"--async");
  try {
    await page.waitForFunction(() => globalThis.detailHeldForCancellation,null,{timeout:10000});
    const cancelled = await ok("analysis","cancel");
    assert.equal(cancelled.status,"complete");
    assert.equal(cancelled.detailStatus,"cancelled");
    const receipt = await run("job","wait",detailJob.requestId,"--timeout","5000");
    assert.equal(receipt.status,"cancelled");
    assert.ok(!(await ok("log","list","--level","error")).some(entry => entry.details?.requestId === detailJob.requestId));
  } finally { await page.evaluate(() => globalThis.restoreDetailWorker()); }
  assert.equal((await ok("analysis","select",id)).id,id);
  await page.locator("#domainInspector [data-aig-analysis-action=locate]").waitFor();
  const detail = await ok("analysis","detail",id,"--section","path-a");
  assert.ok(detail.entries.length >= 2);
  const uiRelated = await page.locator("#domainInspector [data-aig-analysis-select]").evaluateAll(rows => rows.map(row => row.dataset.aigAnalysisSelect));
  const related = await ok("analysis","related",id);
  assert.deepEqual(related.entries.map(row => row.id),uiRelated);
  assert.ok(await page.locator('#schematicMount [data-aig-analysis-role="a"]').count());
  assert.ok(await page.locator('#schematicMount [data-aig-analysis-role="b"]').count());
  await ok("analysis","locate");
  await ok("analysis","retry","detail");
  await ok("analysis","clear");
  assert.equal((await ok("analysis","status")).selected,null);
  assert.equal(await page.locator("#schematicMount [data-aig-analysis-role]").count(),0);
  await fails("analysis","select","missing-result");
  const blocks = await ok("analysis","results","blocks");
  assert.equal(blocks.total,3);
  assert.ok((await ok("analysis","detail",blocks.entries[0].id,"--section","pins")).entries.length);
  await fails("analysis","detail",id,"--section","pins");
  assert.equal((await ok("analysis","status")).selected,blocks.entries[0].id);
  await fails("analysis","retry","detail");
  await fails("analysis","related","absent");
  await page.evaluate(() => {
    const original = Worker.prototype.postMessage;
    globalThis.restoreStructureBudget = () => { Worker.prototype.postMessage = original; };
    Worker.prototype.postMessage = function(message,...rest) {
      if (message?.type === "analyze") message = {...message,policy:{...message.policy,results:1}};
      return original.call(this,message,...rest);
    };
  });
  try {
    const limited = await run("analysis","run");
    assert.equal(limited.status,"partial");
    assert.ok(limited.result.reasons.includes("result-limit"));
    assert.ok(limited.result.reconvergence > 0);
    assert.ok((await ok("analysis","results","blocks")).entries.length);
  } finally { await page.evaluate(() => globalThis.restoreStructureBudget()); }
  await page.evaluate(() => {
    const original = Worker.prototype.postMessage;
    globalThis.restoreStructureWorker = () => { Worker.prototype.postMessage = original; };
    Worker.prototype.postMessage = function(message,...rest) {
      if (message?.type === "analyze") { globalThis.structureHeldForCancellation = true; return; }
      return original.call(this,message,...rest);
    };
  });
  const inflight = await run("analysis","run","--async");
  try {
    await page.waitForFunction(() => globalThis.structureHeldForCancellation, null, {timeout:10000});
    await ok("analysis","cancel");
    assert.equal((await run("job","wait",inflight.requestId,"--timeout","5000")).status,"cancelled");
  } finally { await page.evaluate(() => globalThis.restoreStructureWorker()); }
  assert.equal((await ok("analysis","status")).status,"cancelled");
  await ok("ui","status");
  assert.ok((await ok("ui","controls")).some(control => control.ref === "search"));
  await ok("ui","panel","navigator","open");
  const resized = await ok("ui","resize","navigator","288");
  assert.equal(resized.width,288);
  await ok("ui","tab","navigator","objects");
  assert.ok(await page.locator("#domainNavigator [data-aig-nav-content=objects]").isVisible());
  await ok("ui","menu","file","open");
  assert.ok(await page.locator("#fileMenu").evaluate(el => el.open));
  await ok("ui","disclosure","fileMenu","close");
  await ok("ui","focus","search");
  assert.equal(await page.evaluate(() => document.activeElement.id),"searchInput");
  await ok("ui","help","open");
  await ok("ui","dismiss");
  assert.equal(await page.locator("#helpDialog").evaluate(el => el.open),false);
  await fails("ui","page","absent-list","1");
  await fails("ui","tab","navigator","absent-tab");
  await ok("text","open","aig","--action","add");
  await ok("text","set",".model added\n.inputs a b\n.outputs y\n.names a b y\n11 1\n.end");
  await ok("text","view","logic");
  const input = page.locator("#netlistTextInput");
  await input.evaluate(el => {
    const data = new DataTransfer();
    data.setData("text/plain","x".repeat(300000));
    el.select();
    el.dispatchEvent(new ClipboardEvent("paste",{clipboardData:data,bubbles:true,cancelable:true}));
  });
  assert.equal(await input.evaluate(el => el.readOnly),true);
  assert.equal((await ok("text","expand")).length,300000);
  assert.equal(await input.evaluate(el => el.readOnly),false);
  await ok("text","clear");
  await ok("text","cancel");
  assert.equal((await ok("module","list")).length,1);
  await fails("text","set","closed");
  for (const op of ["submit","clear","expand","cancel"]) await fails("text",op);
  await fails("text","view","logic");
  await fails("text","open","unknown-kind");
  await ok("text","open","aig","--action","add");
  await ok("text","set",".model added\n.inputs a b\n.outputs y\n.names a b y\n11 1\n.end");
  await ok("text","submit");
  assert.equal((await ok("module","list")).length,2);
  await ok("diagnostics","list");
  await ok("log","filter","--level","error","--phase","all");
  const events = await ok("log","list");
  assert.ok(events.length && events.every(entry => entry.level === "error"));
  const entry = events.find(entry => entry.details);
  assert.equal((await ok("log","detail",String(entry.sequence))).sequence,entry.sequence);
  assert.ok(await page.locator("#processLogList details[open]").count());
  await ok("log","autoscroll","off");
  const copied = (await ok("log","copy")).text;
  assert.deepEqual(copied.split("\n").map(line => JSON.parse(line)),events);
  assert.equal((await ok("log","export","--out",outputDir + "/events.jsonl","--overwrite")).bytes,Buffer.byteLength(copied));
  await fails("log","detail","999999");
  await ok("log","clear");
  assert.equal((await ok("log","list")).length,0);
  const source = "module top(input a,input b,output z,output w); NAND2 g1(.A(a),.B(b),.Y(z)); BUF g2(.A(a),.Y(w)); endmodule\n" +
    "module peer(input a,input b,output z,output w); NOR2 g3(.A(a),.B(b),.Y(z)); BUF g4(.A(a),.Y(w)); endmodule";
  await ok("design","open","--text",source,"--name","pair.v");
  for (const argv of [["view","standard"],["objects"],["names"],["connections","all"],["overlay","critical","on"],
                      ["fanout-threshold","25"],["reveal-selection"]]) await fails("aig",...argv);
  await ok("compare","enter");
  await ok("path","open","--side","B");
  await ok("path","add","start","input:b");
  assert.equal((await ok("path","cancel","--side","A")).cancelled,false);
  assert.equal(await page.locator("#pathSide").inputValue(),"right");
  await ok("path","open","--side","A");
  assert.deepEqual((await ok("path","draft")).starts,[]);
  await ok("path","open","--side","B");
  assert.deepEqual((await ok("path","draft")).starts,["input:b"]);
  await ok("path","apply");
  const download = page.waitForEvent("download");
  await ok("path","export","--side","B","--download");
  const svg = await readFile(await (await download).path(),"utf8");
  assert.match(svg,/right/);
  assert.match(svg,/From start/);
  assert.equal((await ok("analysis","run","--side","B")).status,"complete");
  assert.equal((await ok("analysis","results","reconvergence","--side","A")).total,0);
  await fails("analysis","results","blocks","--side","B");
  await fails("analysis","related","absent","--side","B");
  await ok("path","add","end","output:w");
  assert.equal((await ok("path","apply")).status,"no-path");
  const unreachable = await ok("path","report","ends");
  assert.equal(unreachable.entries.find(row => row.id === "output:w").reachable,false);
  return {passed:[...passed],failedAsExpected:[...boundary],reconvergence:analysis.reconvergence,blocks:analysis.blocks,
    level:2,compareExport:true,cancelledRun:true,cancelledPath:true,unreachable:true,partialAnalysis:true};
}
