import test from "node:test";
import assert from "node:assert/strict";
import { createAnalysisCommands } from "../../src/app/remote_analysis_commands.js";
import { createAigInspectionCommands } from "../../src/app/aig_inspection_commands.js";
import { createProcessLog } from "../../src/app/processLog.js";
import { bindShowPath } from "../../src/ui/show_path_controller.js";

test("invalid structure detail sections leave the selected result, page and visible tab intact", async () => {
  const item = {id:"block:1", category:"block", pins:{}};
  const panels = {navigator:{tab:"objects"},analysis:{selectedId:"old",detailPage:4}};
  let selected = 0;
  const execute = createAigInspectionCommands({read:() => ({document:{}}),readPanels:() => panels,
    structure:{view:() => ({query:{get:() => item}}),selectResult:() => selected++}});
  await assert.rejects(execute({name:"analysis detail",args:[item.id],opts:{section:"path-a"}}),{code:"INVALID_ARGUMENT"});
  await assert.rejects(execute({name:"analysis detail",args:[item.id],opts:{section:"summary","page-number":2}}),{code:"PAGE_OUT_OF_RANGE"});
  assert.equal(selected,0);
  assert.deepEqual(panels,{navigator:{tab:"objects"},analysis:{selectedId:"old",detailPage:4}});
});

test("late results from a superseded visible AIG scope cannot acknowledge the new scope's analysis", async () => {
  const document = {}, initial = {document,sessionId:"a",analysisScopeId:"whole"};
  let workspace = initial, finish;
  const complete = new Promise(resolve => { finish = resolve; });
  const execute = createAigInspectionCommands({read:() => workspace,readPanels:() => ({}),
    structure:{run:() => complete,view:() => ({status:"complete"})}});
  const job = execute({name:"analysis run",args:[],opts:{}});
  workspace = {...initial,analysisScopeId:"focused"};
  finish();
  await assert.rejects(job,{code:"STALE_DOCUMENT"});
});

test("a superseded command cannot claim a completed replacement analysis or detail in the same graph", async () => {
  const item = {id:"pair",category:"reconvergence"};
  const workspace = {document:{},sessionId:"same",analysisScopeId:"visible"};
  const panels = {navigator:{},analysis:{}};
  const view = {status:"complete",detailStatus:"complete",selectedId:item.id,query:{get:() => item}};
  const run = createAigInspectionCommands({read:() => workspace,readPanels:() => panels,
    structure:{view:() => view,run:async () => undefined,selectResult:async () => undefined}});
  for (const [name,args] of [["analysis run",[]],["analysis select",[item.id]],["analysis retry",["detail"]]]) {
    await assert.rejects(run({name,args,opts:{}}),{code:"CANCELLED"});
  }
});

test("a Compare cancellation leaves a pending path apply and its panel on the other side", async () => {
  const elements = new Map(), logs = [];
  const get = key => {
    if (!elements.has(key)) elements.set(key,{value:"",querySelector:get,addEventListener(){},replaceChildren(){},toggleAttribute(){},setAttribute(){}});
    return elements.get(key);
  };
  const panel = get("panel");
  panel.ownerDocument = {getElementById:get,addEventListener(){},dispatchEvent(){},defaultView:{MutationObserver:class { observe(){} }}};
  let release, signal;
  const read = (side = "left") => ({side, scope:"view:" + side,query:null,graph:null,
    index:() => ({endpoints:new Map([["start",{key:"start"}]])}),
    apply(_query,pendingSignal) { signal = pendingSignal; return new Promise(resolve => {release = resolve;}); }});
  const command = bindShowPath(panel,{read,subscribe(){},log:(...args) => logs.push(args)});
  const run = (name,args = [],opts = {}) => command({name,args,opts});
  await run("path add",["start","start"],{side:"B"});
  const work = run("path apply");
  assert.equal((await run("path cancel",[],{side:"A"})).cancelled,false);
  assert.equal(signal.aborted,false);
  assert.equal(get("pathSide").value,"right");
  assert.equal((await run("path cancel",[],{side:"B"})).cancelled,true);
  assert.equal(signal.aborted,true);
  assert.equal((await run("path cancel",[],{side:"B"})).cancelled,false);
  release(false);
  await assert.rejects(work,{name:"AbortError"});
  assert.deepEqual(logs,[]);
});

test("log filters use real select values, keep earlier filters on failure, and reveal a hidden entry", async () => {
  const model = createProcessLog();
  model.append({level:"info",phase:"graph",message:"ready"});
  const original = new Error("fixture");
  const entry = model.append({level:"error",phase:"parse",message:"parse failed",details:{error:original}});
  const select = options => ({options:options.map(value => ({value})),value:""});
  const controls = {processLogLevelFilter:select(["","info","error"]),processLogPhaseFilter:select(["","graph","parse"])};
  const details = {open:false};
  let opens = 0;
  controls.processLogList = {querySelectorAll:() => [{dataset:{logSequence:String(entry.sequence)},querySelector:() => details}]};
  const run = createAnalysisCommands({document:{getElementById:id => controls[id]},
    processLogController:{model,render(){},toggle(){opens++;}}});
  const execute = (name,args = [],opts = {}) => run({name,args,opts});
  assert.deepEqual(await execute("log filter",[],{level:"info",phase:"all"}),{level:"info",phase:"all"});
  await assert.rejects(execute("log filter",[],{level:"error",phase:"unknown"}),{code:"INVALID_ARGUMENT"});
  assert.deepEqual((await execute("log list")).map(row => row.message),["ready"]);
  assert.equal((await execute("log detail",[String(entry.sequence)])).details.error.message,original.message);
  assert.equal(opens,1);
  assert.equal(details.open,true);
  assert.equal(controls.processLogLevelFilter.value,"");
  assert.deepEqual((await execute("log export")).text,(await execute("log copy")).text);
  await assert.rejects(execute("log detail",["missing"]),{code:"LOG_NOT_FOUND"});
});
