import test from "node:test";
import assert from "node:assert/strict";
import { createAnalysisCommands } from "../../src/app/remote_analysis_commands.js";
import { createAigInspectionCommands } from "../../src/app/aig_inspection_commands.js";
import { createProcessLog } from "../../src/app/processLog.js";

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
