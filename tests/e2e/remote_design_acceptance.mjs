import { verifyStandaloneSvgStyles } from "./standalone_svg_styles.mjs";
import assert from "node:assert/strict";
import {join} from "node:path";
import {readFile,writeFile} from "node:fs/promises";

export async function verifyDesignCommands({run,page,dir}) {
  const ok = async (...argv) => {
    const reply = await run(...argv);
    assert.equal(reply.status,"committed",JSON.stringify({command:argv.slice(0,2),reply}));
    return reply.result;
  };
  const fail = async (code,...args) => assert.equal((await run(...args)).error?.code,code,args.join(" "));
  const source = "module top(input a,output y); BUF u_buf(.A(a),.Y(y)); endmodule\n" +
    "module alt(input a,output y); BUF u_other(.A(a),.Y(y)); endmodule\n" +
    "module third(input a,output y); assign y = a; endmodule";
  const report = (module,point,value) => "@module "+module+"\npoint at rt slack\n"+point+" 0.10 0.20 "+value+"\n";
  await ok("design","open","--text",source,"--name","dual.v");
  await ok("module","open","top");
  await ok("timing","open","--text",report("top","a","0.10"),"--name","top.rpt");
  assert.deepEqual((await ok("timing","metric","at")).metrics,["at"]);
  assert.equal((await ok("timing","threshold","0.15")).threshold,0.15);
  assert.equal(await page.locator("#timingSlackThresholdInput").inputValue(),"0.15");
  await ok("timing","badge","a","a","slack","on");
  await ok("timing","badge-position","a","top-left");
  await ok("timing","reset-badges","a");
  await ok("timing","log-details","u_buf");
  await fail("INVALID_ARGUMENT","timing","threshold","nan");
  const lib = 'library(test){cell(BUF){pin(A){direction:input;}pin(Y){direction:output;function:"A";}}}';
  await ok("liberty","load","--text",lib,"--name","test.lib");
  assert.equal((await ok("liberty","status")).cellCount,1);
  assert.match(await page.locator("#libertySummary").textContent(),/test.lib/);
  await ok("liberty","cancel");
  await ok("liberty","unload");
  assert.equal((await ok("liberty","status")).loaded,false);
  await ok("cell-config","edit","BUF");
  await ok("cell-config","gate","BUF");
  await ok("cell-config","pin","Y","output");
  await ok("cell-config","save");
  assert.equal((await ok("cell-config","show","BUF")).saved.pins.Y,"output");
  await ok("cell-config","edit","BUF"); await ok("cell-config","cancel");
  const config = join(dir,"definitions.json");
  await ok("cell-config","export","--out",config);
  assert.equal(JSON.parse(await readFile(config,"utf8")).cells.BUF.pins.Y,"output");
  await fail("CELL_CONFIG_CONFLICT","cell-config","import",config);
  await ok("cell-config","import",config,"--on-conflict","replace");
  await ok("cell-config","delete","BUF");
  await ok("cell-config","import",config);
  await fail("CONFIRM_REQUIRED","cell-config","reset");
  await ok("cell-config","reset","--confirm");
  await fail("DOMAIN_MISMATCH", "compare", "split", "vertical");
  const wrongMode = await run("compare","sync-selection","off");
  assert.equal(wrongMode.error?.code,"DOMAIN_MISMATCH");
  const matchesRequest = entry => entry.level === "error" && entry.details?.requestId === wrongMode.requestId;
  const logged = (await ok("log","list","--level","error")).filter(matchesRequest);
  assert.equal(logged.length,1);
  const {details} = await ok("log","detail",String(logged[0].sequence));
  assert.equal(details.operation,"compare sync-selection");
  assert.equal(details.code,"DOMAIN_MISMATCH");
  assert.equal(details.page,wrongMode.page);
  assert.ok(details.error.stack);
  const logPath = join(dir,"compare-sync-log.jsonl");
  await ok("log","export","--out",logPath,"--overwrite");
  const exported = (await readFile(logPath,"utf8")).trim().split("\n").map(line => JSON.parse(line)).filter(matchesRequest);
  assert.equal(exported.length,1);
  assert.equal(exported[0].details.error.stack,details.error.stack);
  await ok("compare","enter");
  const before = (await ok("compare","status")).applied;
  const other = before.B === "third" ? "alt" : "third";
  await ok("compare","module","B",other);
  const draft = await ok("compare","status");
  assert.deepEqual(draft.applied,before);
  assert.equal(draft.draft.B,other);
  await ok("compare","apply");
  assert.equal((await ok("compare","status")).applied.B,other);
  await ok("compare","side","B");
  await ok("compare","split","vertical");
  await ok("compare","sync-viewport","off");
  await ok("compare","sync-roots","off");
  for (const value of ["on","off"]) {
    const status = await ok("compare","sync-selection",value);
    assert.equal(status.syncSelection,value === "on");
    assert.equal((await ok("compare","status")).syncSelection,value === "on");
    assert.equal(await page.locator("#syncCompareSelectionInput").isChecked(),value === "on");
    await page.waitForFunction(expected => document.querySelector("#compareSyncSummary").textContent === expected,
      value === "on" ? "Linked: click" : "Independent views");
    assert.deepEqual([status.syncViewport,status.syncRoots],[false,false]);
    assert.equal(await page.locator("#syncCompareInput").isChecked(),false);
    assert.equal(await page.locator("#syncCompareFocusInput").isChecked(),false);
  }
  assert.ok((await ok("compare","outputs")).some(x=>x.id==="y"));
  await ok("compare","cone","y","--depth","2");
  assert.equal((await ok("compare","cone-depth","3")).depth,3);
  await ok("compare","cone","--whole");
  await ok("compare","summary");
  await ok("--side","B","timing","open","--text",report(other,"a","-0.05"),"--name","B.rpt");
  assert.equal((await ok("--side","B","timing","show","a"))[0].slack,-0.05);
  assert.equal((await ok("--side","A","timing","show","a"))[0].slack,0.10);
  await ok("compare","clear-timing","B");
  assert.equal((await ok("compare","status")).timing.B,null);
  const added = join(dir,"side design.v");
  await writeFile(added,"module extra(input a,output y); assign y=a; endmodule");
  await ok("compare","design","B",added);
  await ok("compare","split","horizontal");
  await ok("compare","split","vertical");
  await page.keyboard.press("Control+z");
  await page.waitForFunction(() => document.querySelector("#compareLayoutSelect").value === "horizontal");
  await page.keyboard.press("Control+Shift+z");
  await page.waitForFunction(() => document.querySelector("#compareLayoutSelect").value === "vertical");
  await ok("--side", "B", "selection", "set", "input:a");
  for (const [side, mount, selected] of [["A", "#leftSchematicMount", ".is-compare-counterpart"],
    ["B", "#rightSchematicMount", ".is-selected"]]) {
    const path = join(dir, side + "-selected.svg");
    await ok("--side", side, "svg", "export", "--out", path);
    await verifyStandaloneSvgStyles(page, await readFile(path, "utf8"), mount, [
      ".node" + selected + " .node-selection-outline", ".node.input .node-shape", ".edge .wire"
    ]);
  }
  const compareLayout = await page.evaluate(() => ({
    labels: [...document.querySelectorAll("#comparePanel > label")].map(label => getComputedStyle(label).display),
    content: document.querySelectorAll("#compareMount .schematic-content").length,
    duplicateIds: [...document.querySelectorAll("#compareMount [id]")].filter(el => document.querySelectorAll("#" + CSS.escape(el.id)).length > 1).map(el => el.id)
  }));
  assert.deepEqual(compareLayout, { labels: ["flex", "flex", "flex"], content: 2, duplicateIds: [] });
  assert.equal(await page.locator("#focusSelectedButton").isEnabled(), true);
  assert.equal(await page.locator("#addFocusedRootButton").isEnabled(), false);
  const peerViewport = await ok("--side", "A", "viewport", "get");
  await ok("--side", "B", "selection", "zoom");
  assert.deepEqual(await ok("--side", "A", "viewport", "get"), peerViewport);
  await ok("compare","exit");
  const modulesBeforeReload = (await ok("module","list")).map(module => module.name);
  await page.reload();
  await page.waitForFunction(() => /^p\d+/.test(document.querySelector("#remotePageLabel")?.textContent));
  await page.waitForSelector("#schematicMount svg");
  const savedFiles = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("netlistGraphBuilder.session.v2")).sourceFiles.map(file => file.name));
  assert.equal(savedFiles.length, 2);
  assert.ok(savedFiles.some(name => name.endsWith("side design.v")));
  assert.ok(modulesBeforeReload.includes("extra"));
  assert.deepEqual((await ok("module","list")).map(module => module.name), modulesBeforeReload);
  await ok("compare","enter");
  const restored = await ok("compare","status");
  assert.deepEqual([restored.syncViewport,restored.syncSelection,restored.syncRoots], [false,false,false]);
  await ok("compare","exit");
  await ok("aig","import-mode","search-first");
  assert.equal(await page.locator("#aigSearchFirstInput").isChecked(),true);
  await ok("aig","import-mode","normal");
  await ok("aig","cancel-import");
  return {timing:[0.10,-0.05],applied:before,draft:other,cellType:"BUF"};
}
