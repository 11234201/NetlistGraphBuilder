import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {createInterface} from "node:readline";
import {mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {catalogue,parseCommand} from "../../tools/workbench_broker.mjs";
import {verifyRemoteNavigation} from "./remote_navigation_acceptance.mjs";
import {verifyTimingPresentation} from "./workbench_timing_acceptance.mjs";
import {verifyDesignCommands} from "./remote_design_acceptance.mjs";
import {verifyAnalysisAcceptance} from "./remote_analysis_acceptance.mjs";

import {verifyCommandDiagnostics} from "./workbench_diagnostics_acceptance.mjs";
import {verifyPickerAndClipboard} from "./workbench_picker_clipboard_acceptance.mjs";
import {countWorkbenchWorkers,verifyResourceLimits} from "./workbench_resource_acceptance.mjs";

const {chromium} = await import(process.env.NGB_PLAYWRIGHT_MODULE || "playwright");
const project = resolve(fileURLToPath(new URL("../..",import.meta.url)));
const adapter = process.argv[2] || "npm";
const launchers = {npm:[process.execPath,join(project,"tools/serve.mjs")], elf:[join(project,"build/native/ngb")],
  python:[process.env.NGB_PYTHON || "python3",join(project,"tools/serve.py")],windows:[process.env.NGB_WINDOWS_EXE]};
const [exe,...prefix] = launchers[adapter];
if (!exe) throw new Error("Set NGB_WINDOWS_EXE to the extracted offline launcher");
const fullGroups = ["host","design","navigation","analysis","limits"];
const groups = process.env.NGB_TEST_GROUPS?.split(",") || fullGroups;
const dir = await mkdtemp(join(tmpdir(),"ngb-command-verification-"));
const state = join(dir,"session.json");
const env = {...process.env,NGB_LOG_DIR:join(dir,"logs")};
const settings = {cwd:project,env,windowsHide:true};
const seen = new Set(), boundaries = new Set(), report = {adapter,groups};
const child = spawn(exe,[...prefix,"start","--port","0","--no-open","--interactive","--state-file",state,
  "--browse-root",dir,"--browse-root",project],settings);
let browser,stopped = false,stderr = "";
const closed = once(child,"close");
child.stderr.on("data",chunk=>{stderr=(stderr+chunk).slice(-3000);});
const lines = createInterface({input:child.stdout});
let target;
async function call(args,cliArgs=[]) {
  const process = spawn(exe,[...prefix,...cliArgs,...args],settings);
  const output=[], errors=[];
  process.stdout.on("data",chunk=>output.push(chunk)); process.stderr.on("data",chunk=>errors.push(chunk));
  process.stdin.end();
  const [code] = await once(process,"close");
  return {code,stdout:Buffer.concat(output).toString(),stderr:Buffer.concat(errors).toString()};
}
async function run(...argv) {
  const name = (()=>{try{return parseCommand(argv).name;}catch{return argv.slice(0,2).join(" ");}})();
  const {stdout,stderr} = await call(argv,["cmd","--state-file",state,...(!argv.includes("--page") && target ? ["--page",target] : []),...(!argv.includes("--timeout") ? ["--timeout","15000"] : [])]);
  if (!stdout.trim()) throw new Error(name+" empty CLI reply: "+stderr.slice(-400));
  const receipt = JSON.parse(stdout);
  if (receipt.status === "committed" && !receipt.error) seen.add(name);
  if (receipt.error) boundaries.add(name);
  return receipt;
}
async function ok(...args) {
  const r = await run(...args);
  const expected = args.includes("--async") ? ["reading","queued","delivered","executing","committed"] : ["committed"];
  assert.ok(!r.error && expected.includes(r.status), JSON.stringify({command:args.slice(0,2),receipt:r}));
  return r;
}
async function register(page,url) {
  await page.goto(url);
  await page.waitForFunction(()=>/^p\d+/.test(document.getElementById("remotePageLabel")?.textContent),undefined,{timeout:20000});
  return JSON.parse(await page.evaluate(()=>sessionStorage.getItem("ngb.remote.page"))).page;
}
try {
  const ready = JSON.parse((await once(lines,"line"))[0]);
  seen.add("start");
  const status = await call(["status","--state-file",state]);
  assert.match(status.stdout,/status=running/); seen.add("status");
  browser = await chromium.launch({executablePath:process.env.NGB_CHROME_BINARY || undefined,headless:true,args:["--no-sandbox"]});
  const ctx = await browser.newContext({viewport:{width:1600,height:1000}});
  await ctx.addInitScript(countWorkbenchWorkers);
  const page = await ctx.newPage();
  page.on("pageerror",e=>console.error("BROWSER",e.message));
  target = await register(page,ready.pairUrl);
  seen.add("cmd");
  if(groups.includes("host")) {
    await ok("help","aig","add"); await ok("commands","--available"); await ok("pages"); await ok("page","info",target);
    await ok("use",target); await ok("page","rename",target,"primary");
    const reserve = (await ok("page","new","--name","secondary")).result;
    const peer = await ctx.newPage();
    const peerId = await register(peer,new URL(reserve.href,ready.url).href);
    await ok("page","wait",peerId);
    const done = await ok("module","list");
    await ok("job","status",done.requestId); await ok("job","wait",done.requestId);
    await peer.route("**/__ngb/workbench",async route=>{
      if (route.request().postDataJSON()?.op==="grant") await route.abort();
      else await route.continue();
    });
    const pending = await ok("--page",peerId,"--async","module","list");
    assert.equal((await run("job","cancel",pending.requestId)).status,"cancelled"); seen.add("job cancel");
    await peer.close();
    for(const args of [["fs","roots"],["fs","pwd"],["fs","ls",dir],["fs","complete",dir],["fs","cd",dir]]) await ok(...args);
    const input=join(dir,"picker.v"); await writeFile(input,"module picked(input a,output y); assign y=a; endmodule");
    await ok("files","browse","--dir",dir); await ok("files","choose",input); await ok("files","cancel");
    await ok("files","browse","--dir",dir,"--action","design open"); await ok("files","choose",input); await ok("files","submit");
    assert.equal((await ok("module","list")).result[0].name,"picked");
    await ok("files","import",input); await ok("design","info");
    await ok("design","add","--text","module extra(input a,output z); assign z=a; endmodule","--name","extra.v");
    const timing="@module picked\npoint at rt slack\na 0.1 0.2 0.1\n";
    await ok("timing","add","--text",timing);
    await ok("svg","export","--out",join(dir,"host.svg"));
    assert.match(await readFile(join(dir,"host.svg"),"utf8"),/<svg/);
  }
  if (groups.includes("host") || groups.includes("picker")) report.pickerClipboard = await verifyPickerAndClipboard({run,page,project});
  if(groups.includes("host")) report.diagnostics = await verifyCommandDiagnostics({run,page,dir,project,target});
  if(groups.includes("design")) report.design=await verifyDesignCommands({run,page,dir});
  if (groups.includes("design") || groups.includes("timing")) report.timing = await verifyTimingPresentation({run,page,dir});
  if (groups.includes("design") || groups.includes("level")) {
    const filename = "aig_mapped_names.level";
    const examples = join(project, "examples");
    const level = join(examples, filename);
    assert.equal((await run("level","open",level)).error?.code, "DOMAIN_MISMATCH");
    assert.equal((await run("text","open","level")).error?.code, "DOMAIN_MISMATCH");
    const wrongMode = await run("files","browse","--action","level open");
    assert.equal(wrongMode.error?.code, "DOMAIN_MISMATCH");
    const logged = (await ok("log","list","--level","error")).result.filter(row => row.details?.requestId === wrongMode.requestId);
    assert.equal(logged.length, 1);
    assert.equal(logged[0].details.operation, "files browse");
    await ok("ui","menu","file","open");
    await page.locator("#serverFiles").click();
    const picker = page.locator("dialog[open]").filter({has:page.locator("[data-action]")});
    await picker.locator("[data-count]").filter({hasText:"/"}).waitFor();
    assert.equal(await picker.locator("[data-action]").inputValue(), "files import");
    assert.equal(await picker.locator('option[value="level open"]:disabled').count(), 1);
    await picker.locator("[data-path]").fill(examples);
    await picker.locator("[data-go]").click();
    await picker.getByLabel(filename, {exact:true}).check();
    await picker.getByLabel("aig_mapped_names.blif", {exact:true}).check();
    const paired = await ok("files","submit");
    assert.deepEqual(paired.result.files.map(file => [file.kind, file.status]), [["level","committed"],["aig","committed"]]);
    const graph = () => ok("module","list").then(reply => reply.result.find(row => row.active));
    const before = await graph();
    assert.equal(before.levelFileName, filename);
    const applied = await ok("level","open",level);
    assert.equal(applied.result.files[0].status, "committed");
    assert.equal((await graph()).levelFileName, filename);
    const inspect = async () => (await ok("inspect","show","w_gen_5291","--tab","analysis")).result.analysis;
    const internal = await inspect();
    assert.equal(internal.topologyLevel, 4);
    assert.deepEqual(internal.levelReport, {at:4, rt:6, slack:2, slackDerived:true});
    const invalid = await run("level","open","--text","unknown_input 2","--name","bad.level");
    assert.equal(invalid.error?.code, "aig.level-unknown-point");
    assert.equal((await graph()).levelFileName, filename);
    const badLevel = join(dir, "failed-pair.level");
    await writeFile(badLevel, "# pair rejected\nunknown_input 2\n");
    const rejectedPair = await run("files","import",join(examples, "aig_mapped_names.blif"),badLevel);
    assert.equal(rejectedPair.error?.code, "IMPORT_FAILED");
    assert.deepEqual(rejectedPair.error.files.map(file => file.status), ["uncommitted","failed"]);
    const logFile = join(dir, "level-errors.jsonl");
    await ok("log","export","--out",logFile);
    const errors = (await readFile(logFile, "utf8")).trim().split(/\r?\n/).map(line => JSON.parse(line));
    const owners = errors.filter(row => row.details?.requestId === rejectedPair.requestId && row.level === "error");
    assert.equal(owners.length, 1);
    assert.equal(owners[0].details.fileName, "failed-pair.level");
    assert.equal(owners[0].details.line, 2);
    assert.equal(owners[0].details.operation, "aig.level.import");
    assert.equal(owners[0].details.error.code, "aig.level-unknown-point");
    assert.equal(owners[0].details.error.stack, rejectedPair.error.details.error.cause.stack);
    assert.equal((await graph()).id, before.id);
    await ok("text","open","level");
    await ok("text","set","n0 6");
    await ok("text","submit");
    assert.equal((await graph()).levelFileName, "pasted Level");
    assert.equal((await inspect()).topologyLevel, 7);
    await ok("files","browse","--action","level open","--dir",examples);
    assert.equal(await picker.locator('option[value="level open"]:enabled').count(), 1);
    await ok("files","choose",level);
    await ok("files","submit");
    const after = await graph();
    assert.equal(after.levelFileName, filename);
    assert.equal(after.id, before.id);
    await ok("aig","import-mode","search-first");
    await ok("aig","open",join(examples,"aig_mapped_names.blif"));
    const selection = (await ok("selection","set","w_gen_5291")).result.selection;
    await ok("level","open",level);
    const selectedId = async () => (await ok("selection","get")).result.selection?.id;
    assert.equal(await selectedId(), selection.id, "Level import retains inspection of a Search-first object");
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Loaded aig_mapped_names.blif"));
    assert.equal(await selectedId(), selection.id, "reload retains the same Search-first selection");
    assert.equal(await page.locator("#schematicMount [data-aig-node]").count(), 0);
    await ok("aig","import-mode","normal");
    report.level = {graph:after.id, file:filename, invalid:invalid.error.code};
  }
  if(groups.includes("navigation")) report.navigation=await verifyRemoteNavigation({command:run,page,project,scratch:dir});
  if(groups.includes("analysis")) report.analysis=await verifyAnalysisAcceptance({run,page,root:project,outputDir:dir});
  if(groups.includes("limits")) report.resources = await verifyResourceLimits({ok,run,page,project});
  if(groups.includes("host")) {
    // Every dispatched command is also exercised at its argument-validation boundary.
    for(const row of catalogue.commands.filter(row=>!["launcher","terminal"].includes(row.target))) {
      const invalidArgs = row.arguments[0] > 0 ? [] : Array(row.arguments[1]+1).fill("extra");
      const bad = await run(...row.name.split(" "),...invalidArgs);
      assert.equal(bad.error?.code,"INVALID_ARGUMENT",row.name);
      boundaries.add(row.name);
    }
  }
  if (groups.includes("host")) {
    for (const name of ["start","status","stop"]) {
      const rejected = await call([name,"--state-file",state,"--port","invalid-port"]);
      assert.notEqual(rejected.code,0,name+" rejected an invalid port");
      boundaries.add(name);
    }
    const empty = await call(["cmd","--state-file",state]);
    assert.equal(JSON.parse(empty.stdout).error.code,"INVALID_ARGUMENT");
    boundaries.add("cmd");
    const other = spawn(exe,[...prefix,"start","--no-open","--interactive","--port","0"],settings);
    const otherClosed=once(other,"close");
    let interactiveLog = "";
    other.stderr.on("data",chunk => {interactiveLog += chunk.toString();});
    const otherLines=createInterface({input:other.stdout});
    try {
      await once(otherLines,"line");other.stdin.end("quit extra\nquit\n");
      assert.equal((await otherClosed)[0],0);seen.add("quit");
      assert.match(interactiveLog,/INVALID_ARGUMENT/); boundaries.add("quit");
    } finally {otherLines.close();if(other.exitCode===null)other.kill();}
  }
  await browser.close();browser=null;
  const stop=await call(["stop","--state-file",state]);
  assert.equal(stop.code,0,stop.stderr); await closed; stopped=true;seen.add("stop");
  report.passed=[...seen].sort();
  report.boundaries=catalogue.commands.map(row=>row.name).filter(name=>boundaries.has(name)).sort();
  report.missing=catalogue.commands.filter(r=>!seen.has(r.name)).map(r=>r.name);
  if (fullGroups.every(group => groups.includes(group))) {
    assert.deepEqual(report.missing,[],"Missing positive command coverage");
    assert.deepEqual(catalogue.commands.filter(row=>!boundaries.has(row.name)).map(row=>row.name),[],"Missing boundary coverage");
  }
  console.log(JSON.stringify(report));
} finally {
  if (process.env.NGB_FULL_REPORT) await writeFile(process.env.NGB_FULL_REPORT,JSON.stringify({...report,observed:[...seen].sort()},null,2));
  lines.close();await browser?.close();
  if(!stopped && child.exitCode===null && child.signalCode===null){child.kill();await closed;}
  await rm(dir,{recursive:true,force:true});
}
