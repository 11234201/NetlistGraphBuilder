import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {createInterface} from "node:readline";
import {mkdir, mkdtemp, readFile, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {closeBrowserTestResources, withBrowserTestTimeout} from "./browser_test_session.mjs";

// Real file service + browser controller: no mocked import or file-selection model.
const {chromium} = await import(process.env.NGB_PLAYWRIGHT_MODULE || "playwright");
const project = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const adapter = process.argv[2] || "npm";
const launchers = {npm:[process.execPath,"tools/serve.mjs"], python:[process.env.NGB_PYTHON || "python3","tools/serve.py"]};
assert.ok(launchers[adapter],"Choose npm or python for the picker browser adapter");
const [executable,...launcherArgs] = launchers[adapter];
const artifacts = process.env.NGB_PICKER_OUTPUT || join(project, "dc_runs");
await mkdir(artifacts, {recursive:true});
const dir = await mkdtemp(join(artifacts, "server_picker_"));
const input = join(dir, "inputs"), bulk = join(input, "bulk"), nested = join(input, "nested");
const longName = "design_with_a_long_hierarchical_name_".repeat(5) + ".v";
const longDirectory = join(nested, "implementation_results_with_a_long_directory_name_".repeat(3));
await Promise.all([mkdir(bulk, {recursive:true}), mkdir(longDirectory, {recursive:true})]);
const verilog = name => `module ${name}(input a, output y); assign y=a; endmodule\n`;
await Promise.all([
  writeFile(join(input, "good.v"), verilog("good")),
  writeFile(join(input, "broken.blif"), ".model broken\n.inputs a\n.outputs y\n.names missing a y\n11 1\n.end\n"),
  writeFile(join(nested, "nested.v"), verilog("nested")),
  writeFile(join(longDirectory, longName), verilog("long_name")),
  ...Array.from({length:105}, (_, i) => writeFile(join(bulk, `design_${String(i).padStart(3,"0")}.v`), verilog(`bulk_${i}`)))
]);
const state = join(dir, "session.json");
const server = spawn(executable, [...launcherArgs, "start", "--no-open", "--port", "0", "--interactive",
  "--state-file", state, "--browse-root", input, "--browse-root", join(project,"examples")],
{cwd:project, windowsHide:true, env:{...process.env,NGB_LOG_DIR:join(dir,"logs")}});
let serverErrors = "", browser, page, target;
server.stderr.on("data", chunk => { serverErrors = (serverErrors + chunk).slice(-10000); });
const lines = createInterface({input:server.stdout});
const pageErrors = [], requests = [];
const report = {adapter, artifacts:dir, checks:[]};
async function run(...argv) {
  const child = spawn(executable, [...launcherArgs, "cmd", "--state-file", state, "--page", target,
    "--timeout", "15000", ...argv], {cwd:project, windowsHide:true, env:{...process.env,NGB_LOG_DIR:join(dir,"logs")}});
  const output=[], errors=[];
  child.stdout.on("data", chunk => output.push(chunk)); child.stderr.on("data", chunk => errors.push(chunk));
  child.stdin.end();
  try { await withBrowserTestTimeout(() => once(child,"close"), 20000, `CLI ${argv.slice(0,2).join(" ")}`); }
  catch (error) { child.kill(); throw error; }
  const text = Buffer.concat(output).toString();
  assert.ok(text.trim(), Buffer.concat(errors).toString());
  return JSON.parse(text);
}
async function ok(...argv) {
  const reply = await run(...argv);
  assert.equal(reply.status,"committed",JSON.stringify(reply));
  return reply.result;
}
const picker = () => page.locator(".server-file-dialog");
const control = name => picker().locator(`[data-${name}]`);
async function navigate(path) {
  if (!await control("path").isVisible()) await control("edit-path").click();
  await control("path").fill(path);
  await control("path").press("Enter");
  await page.waitForFunction(expected => document.querySelector(".server-file-dialog[open] [data-path]")?.value === expected &&
    document.querySelector(".server-file-dialog[open] [data-list-region]")?.getAttribute("aria-busy") === "false" &&
    /\d/.test(document.querySelector(".server-file-dialog[open] [data-count]")?.textContent || ""), path);
}
async function openMain() {
  await ok("ui","menu","file","open");
  await page.locator("#serverFiles").click();
  await control("entries").getByLabel("good.v",{exact:true}).waitFor();
}
async function assertFits(label) {
  const boxes = await picker().evaluate(dialog => {
    const rect = element => { const r=element.getBoundingClientRect(); return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}; };
    return {dialog:rect(dialog), submit:rect(dialog.querySelector("[data-submit]")), cancel:rect(dialog.querySelector("[data-cancel]")),
      list:rect(dialog.querySelector("[data-list-region]")), viewport:{width:innerWidth,height:innerHeight},
      clientWidth:dialog.clientWidth,scrollWidth:dialog.scrollWidth};
  });
  assert.ok(boxes.dialog.x >= 0 && boxes.dialog.y >= 0, JSON.stringify(boxes));
  assert.ok(boxes.dialog.right <= boxes.viewport.width && boxes.dialog.bottom <= boxes.viewport.height, JSON.stringify(boxes));
  assert.ok(boxes.submit.bottom <= boxes.dialog.bottom && boxes.cancel.bottom <= boxes.dialog.bottom, JSON.stringify(boxes));
  assert.ok(boxes.list.height >= 100 && boxes.scrollWidth <= boxes.clientWidth + 1, JSON.stringify(boxes));
  await page.screenshot({path:join(dir,`${label}.png`)});
  return boxes;
}
try {
  const ready = JSON.parse((await withBrowserTestTimeout(() => once(lines,"line"),20000,"Picker server startup"))[0]);
  browser = await chromium.launch({headless:true,executablePath:process.env.NGB_CHROME_BINARY || undefined,args:["--no-sandbox"]});
  page = await browser.newPage({viewport:{width:1366,height:768}});
  page.setDefaultTimeout(10000);
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("request", request => {
    if (request.method()==="POST" && new URL(request.url()).pathname === "/__ngb/workbench") requests.push(request.postDataJSON());
  });
  await page.goto(ready.pairUrl);
  await page.locator("#remotePageLabel").waitFor({state:"visible"});
  target = await page.evaluate(() => JSON.parse(sessionStorage.getItem("ngb.remote.page")).page);
  await openMain();
  assert.equal(await control("action").inputValue(),"files import");
  assert.equal(await control("side-field").isVisible(),false);
  assert.equal(await control("submit").isDisabled(),true);
  await control("entries").getByLabel("good.v",{exact:true}).check();
  assert.match(await control("selection-count").innerText(),/1/);
  report.small = await assertFits("picker_1366");
  await page.setViewportSize({width:1920,height:1080});
  report.large = await assertFits("picker_1920");
  await page.keyboard.press("Escape");
  await picker().waitFor({state:"hidden"});
  assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest("dialog"))),false);
  await openMain();
  await control("entries").getByLabel("good.v",{exact:true}).check();
  report.checks.push("desktop geometry, default auto-detect, Single target, selection summary");

  await navigate(bulk);
  assert.equal(await picker().isVisible(),true,"Enter navigates without submitting the dialog form");
  await control("entries").getByLabel("design_000.v",{exact:true}).check();
  await control("next").click();
  await control("entries").getByLabel("design_104.v",{exact:true}).check();
  await control("selection-toggle").click();
  assert.equal(await control("selected-list").locator("li").count(),3);
  assert.match(await control("selected-list").innerText(),/good.v/);
  await control("selected-list").locator("li").filter({hasText:"design_000.v"}).getByRole("button").click();
  assert.equal(await control("selected-list").locator("li").count(),2);
  await control("selection-clear").click();
  assert.equal(await control("submit").isDisabled(),true);
  report.checks.push("cross-directory and cross-page selections, individual removal, clear");

  await navigate(input);
  const beforeFiltering = requests.filter(request => request.op === "list").length;
  await control("filter").fill("n"); await control("filter").fill("ne"); await control("filter").fill("nested");
  await page.waitForFunction(() => document.querySelector(".server-file-dialog [data-list-region]")?.getAttribute("aria-busy") === "false");
  await control("entries").getByRole("button",{name:"Open folder nested",exact:true}).waitFor();
  const filtering = requests.filter(request => request.op === "list").slice(beforeFiltering);
  assert.deepEqual(filtering.map(request => request.filter),["nested"]);
  await control("filter-clear").click();
  await control("entries").getByLabel("good.v",{exact:true}).waitFor();
  await navigate(longDirectory);
  await control("entries").getByLabel(longName,{exact:true}).check();
  const longRow = control("entries").locator(".server-file-row").first();
  const nameBox = await longRow.locator(".server-file-name").boundingBox();
  const kindBox = await longRow.locator(".server-file-kind").boundingBox();
  assert.ok(nameBox.x + nameBox.width <= kindBox.x,"Long filenames do not overlap the Type column");
  assert.equal(await longRow.locator(".server-file-kind").innerText(),"Verilog");
  if (!await control("selection-panel").isVisible()) await control("selection-toggle").click();
  const modeBefore = await control("action-summary").boundingBox();
  await control("advanced").locator(":scope > summary").click();
  assert.equal((await control("action-summary").boundingBox()).x,modeBefore.x,"Expanding Advanced keeps the mode summary aligned");
  await page.setViewportSize({width:1366,height:768});
  report.longPath = await assertFits("picker_long_path");
  await control("cancel").click();
  report.checks.push("debounced filter, keyboard path navigation, long path and filename");

  await openMain();
  await control("entries").getByLabel("good.v",{exact:true}).check();
  await control("entries").getByLabel("broken.blif",{exact:true}).check();
  const beforeImports = requests.filter(request=>request.op === "import").length;
  let releaseImport;
  const importGate = new Promise(resolve => {releaseImport=resolve;});
  const holdImport = async route => {
    if (route.request().postDataJSON()?.op === "import") await importGate;
    await route.continue();
  };
  await page.route("**/__ngb/workbench",holdImport);
  try {
    const submitted = page.waitForRequest(request => request.method() === "POST" &&
      new URL(request.url()).pathname === "/__ngb/workbench" && request.postDataJSON()?.op === "import");
    await control("submit").click();
    await submitted;
    assert.equal(await control("cancel").isDisabled(),true);
    assert.equal(await control("close").isDisabled(),true);
    assert.equal(await control("filter").isDisabled(),true);
    await page.keyboard.press("Escape");
    assert.equal(await picker().isVisible(),true,"Escape cannot pretend to cancel an already submitted import");
  } finally {
    releaseImport();
    await page.unrouteAll({behavior:"wait"});
  }
  await page.waitForFunction(() => /remaining/i.test(document.querySelector(".server-file-dialog[open] [data-status]")?.textContent || "") &&
    !document.querySelector(".server-file-dialog[open] [data-submit]")?.disabled);
  assert.equal(await control("selected-list").locator("li").count(),1);
  assert.match(await control("selected-list").textContent(),/broken.blif/);
  assert.match(await control("results").innerText(),/good.v/);
  assert.match(await control("results").innerText(),/broken.blif/);
  await assertFits("picker_partial");
  await writeFile(join(input,"broken.blif"),".model fixed\n.inputs a\n.outputs y\n.names a y\n1 1\n.end\n");
  await control("submit").click();
  await picker().waitFor({state:"hidden"});
  const imports = requests.filter(request=>request.op === "import").slice(beforeImports);
  assert.equal(imports.length,2);
  assert.deepEqual(imports.map(request=>request.argv.length),[4,3],"Retry submits only the remaining file handle");
  report.checks.push("real partial import, successful row removal, retry only remaining file");

  const retryDirectory = join(input,"retry_batch");
  await mkdir(retryDirectory);
  for (const kind of ["netlist","aig"]) {
    const extension = kind === "netlist" ? "v" : "blif";
    const valid = name => kind === "netlist" ? verilog(name) :
      `.model ${name}\n.inputs a\n.outputs y\n.names a y\n1 1\n.end\n`;
    const invalid = kind === "netlist" ? "// Intentionally contains no module declaration.\n" :
      ".model broken\n.inputs a\n.outputs y\n.names missing a y\n11 1\n.end\n";
    const firstName = `first.${extension}`, retryName = `retry.${extension}`;
    for (const action of ["files import","design open"]) {
      await writeFile(join(retryDirectory,firstName),valid("first"));
      await writeFile(join(retryDirectory,retryName),invalid);
      await ok("files","browse","--dir",retryDirectory,"--action",action);
      await control("entries").getByLabel(firstName,{exact:true}).check();
      await control("entries").getByLabel(retryName,{exact:true}).check();
      if (action === "design open") {
        const receipt = await run("files","submit");
        assert.equal(receipt.status,"failed");
        assert.deepEqual(receipt.error.files.map(file=>file.status),["committed","failed"]);
      } else await control("submit").click();
      await page.waitForFunction(() => document.querySelectorAll(".server-file-dialog[open] [data-selected-list] li").length === 1 &&
        !document.querySelector(".server-file-dialog[open] [data-submit]")?.disabled);
      const firstLoaded = await ok("module","list");
      assert.equal(firstLoaded.length,1,`${action} ${kind} commits the first input before failure`);
      const firstIdentity = firstLoaded[0].id || firstLoaded[0].name;
      assert.match(await control("selected-list").innerText(),new RegExp(retryName.replace(".","\\.")));
      await writeFile(join(retryDirectory,retryName),valid("second"));
      await control("submit").click();
      await picker().waitFor({state:"hidden"});
      const completed = await ok("module","list");
      assert.deepEqual(completed.map(row=>row.name).sort(),
        kind === "netlist" ? ["first","second"] : [firstName,retryName],
        `${action} ${kind} retry preserves the previously committed input`);
      assert.ok(completed.some(row=>(row.id || row.name) === firstIdentity));
      report.checks.push(`${action} ${kind}: retry retains committed design${action === "design open" ? " across CLI failure and UI retry" : ""}`);
    }
  }

  await ok("design","open","--text",verilog("left")+verilog("right"),"--name","compare.v");
  await ok("compare","enter");
  for (const [menu,side] of [["compareLeftFilesMenu","A"],["compareRightFilesMenu","B"]]) {
    const menuElement = page.locator(`#${menu}`);
    if (!await menuElement.evaluate(element=>element.open)) await menuElement.locator(":scope > summary").click();
    await menuElement.getByRole("button",{name:"Open from server…",exact:true}).click();
    await control("entries").getByLabel("good.v",{exact:true}).waitFor();
    assert.equal(await control("action").inputValue(),"design add");
    assert.equal(await control("side").inputValue(),side);
    assert.equal(await control("side-field").isVisible(),true);
    await control("cancel").click();
  }
  await ok("compare","exit");
  report.checks.push("Compare A/B menu keeps append action and explicit target");

  await writeFile(join(input,"broken.blif"),".model broken\n.inputs a\n.outputs y\n.names missing a y\n11 1\n.end\n");
  await ok("log","clear");
  await ok("files","browse","--dir",input,"--action","files import");
  await ok("files","choose",join(input,"broken.blif"));
  const failedSubmission = await run("files","submit");
  assert.equal(failedSubmission.status,"failed");
  assert.equal(failedSubmission.error.code,"IMPORT_FAILED");
  const submissionErrors = (await ok("log","list","--level","error"))
    .filter(entry => entry.details?.requestId === failedSubmission.requestId);
  assert.equal(submissionErrors.length,1,"CLI failed batch must retain one original-error owner: " + JSON.stringify(submissionErrors));
  assert.ok(submissionErrors[0].details.error.stack);
  assert.equal(submissionErrors[0].details.fileName,"broken.blif");
  assert.equal(submissionErrors[0].details.page,target);
  await control("cancel").click();
  await ok("ui","panel","log","open");
  const failedRow = page.locator("#processLogList li").filter({hasText:submissionErrors[0].message});
  assert.equal(await failedRow.count(),1);
  await failedRow.locator("summary").click();
  const failedDetails = JSON.parse(await failedRow.locator("details[open] pre").innerText());
  assert.equal(failedDetails.requestId,failedSubmission.requestId);
  assert.equal(failedDetails.error.code,"aig.undefined-input");
  const failedDownload = page.waitForEvent("download");
  await page.locator("#exportProcessLogButton").click();
  const failedExport = (await readFile(await (await failedDownload).path(),"utf8"))
    .trim().split(/\r?\n/).map(line=>JSON.parse(line));
  const failedOwners = failedExport.filter(entry => entry.details?.requestId === failedSubmission.requestId && entry.level === "error");
  assert.equal(failedOwners.length,1);
  assert.deepEqual(failedOwners[0].details,failedDetails);
  report.checks.push("CLI failed batch preserves original file diagnostics without a second aggregate error");

  await ok("log","clear");
  const original = await ok("design","info");
  let rejectListing = true;
  const fault = async route => {
    const request = route.request().postDataJSON();
    if (request.op === "list" && request.path === longDirectory && rejectListing) {
      rejectListing = false;
      await route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:{
        code:"PICKER_TEST_LIST_FAILED",message:"Picker directory unavailable (injected)",
        stack:"Error: Picker directory unavailable (injected)\n    at testFileService (server_file_picker_e2e:1:1)",
        cause:{name:"Error",message:"upstream directory read failed",stack:"Error: upstream directory read failed\n    at directoryRead (server_file_picker_e2e:2:1)"}
      }})});
    } else await route.continue();
  };
  await page.route("**/__ngb/workbench",fault);
  await openMain();
  await control("edit-path").click();
  await control("path").fill(longDirectory); await control("path").press("Enter");
  await control("retry").waitFor({state:"visible"});
  assert.match(await picker().innerText(),/Picker directory unavailable/);
  assert.equal(await control("submit").isDisabled(),true);
  await control("retry").click();
  await control("entries").getByLabel(longName,{exact:true}).waitFor();
  await control("cancel").click();
  await page.unroute("**/__ngb/workbench",fault);
  assert.equal((await ok("design","info")).documentVersion,original.documentVersion);
  await ok("ui","panel","log","open");
  const logRow=page.locator("#processLogList li").filter({hasText:"Picker directory unavailable (injected)"});
  assert.equal(await logRow.count(),1);
  await logRow.locator("summary").click();
  const detail=JSON.parse(await logRow.locator("details[open] pre").innerText());
  assert.equal(detail.code,"PICKER_TEST_LIST_FAILED");
  assert.equal(detail.operation,"files.list");
  assert.equal(detail.page,target);
  assert.equal(detail.documentVersion,original.documentVersion);
  assert.ok(detail.requestId);
  assert.match(detail.error.stack,/testFileService/);
  assert.match(detail.error.cause.stack,/directoryRead/);
  const download=page.waitForEvent("download");
  await page.locator("#exportProcessLogButton").click();
  const exported=(await readFile(await (await download).path(),"utf8")).trim().split(/\r?\n/).map(line=>JSON.parse(line));
  const failures=exported.filter(row=>row.details?.code === "PICKER_TEST_LIST_FAILED");
  assert.equal(failures.length,1);
  assert.deepEqual(failures[0].details,detail);
  report.checks.push("directory failure and retry, original context/stack/cause, unique Log details and exported JSONL");
  assert.deepEqual(pageErrors,[]);
  await writeFile(join(dir,"report.json"),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} catch (error) {
  if (page) await page.screenshot({path:join(dir,"failure.png")}).catch(()=>{});
  await writeFile(join(dir,"failure.txt"),String(error.stack)+"\n"+serverErrors+"\n"+JSON.stringify(pageErrors));
  throw error;
} finally {
  lines.close();
  await closeBrowserTestResources({browser,server});
}
