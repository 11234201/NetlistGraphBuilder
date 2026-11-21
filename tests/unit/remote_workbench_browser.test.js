import test from "node:test";
import assert from "node:assert/strict";
import { createRemoteFileImport, compareSideFor } from "../../src/app/remote_file_import.js";
import { bindRemoteWorkbench } from "../../src/app/remote_workbench.js";
import { createRemoteCellConfigImport } from "../../src/app/remote_cell_config.js";
import { createAigCollection } from "../../src/app/aig_collection.js";
import { collectionLimits } from "../../src/persistence/aig_collection_storage.js";
import { getQuickInputPriority } from "../../src/app/quickInput.js";
import { createImportRequests } from "../../src/application/import_requests.js";

function importer(loadText, initialMode = "Single", importRequests = createImportRequests()) {
  const errors = [], requests = [];
  let mode = initialMode;
  const run = createRemoteFileImport({
    context: () => ({mode,documentId:"document:"+mode,documentVersion:mode === "Single" ? 2 : 1}),
    graphs: { add() { throw Error("Unexpected AIG batch"); } },
    loadText: async (text, options) => {
      requests.push({name:options.label, kind:options.kind, append:options.append});
      await loadText(text, options);
      if (options.kind === "netlist") mode = "Single";
      if (options.kind === "aig") mode = "AIG";
      return options.kind;
    },
    loadCellConfig() { throw Error("Unexpected Cell Config"); },
    importRequests,
    priority:kind => mode === "AIG" && kind === "netlist" ? -2 : getQuickInputPriority(kind),
    logFile:(error, operation, id, details) => errors.push({error, operation, id, details})
  });
  return {run, errors, requests};
}

test("server mixed import prioritizes designs, returns every original file row and retains an error's context", async () => {
  const broken = Error("bad BLIF");
  const {run, errors, requests} = importer(text => { if (text === "broken") throw broken; }, "AIG");
  const files = [
    {name:"timing.rpt", text:"timing"}, {name:"design.v", text:"netlist"},
    {name:"broken.blif", text:"broken"}, {name:"missing", error:{code:"ENOENT",message:"Missing file"}},
    {name:"more.v", text:"netlist2"}
  ];
  const result = await run({name:"files import",id:"r1",opts:{},files});
  assert.equal(result.partial, true);
  assert.deepEqual(result.files.map(row => row.name), files.map(file => file.name));
  assert.deepEqual(result.files.map(row => row.status), ["committed","committed","failed","failed","committed"]);
  assert.equal(result.files[3].error.code, "ENOENT");
  assert.deepEqual(requests.map(r => [r.name,r.append]), [
    ["design.v",false],["more.v",true],["broken.blif",false],["timing.rpt",false]
  ]);
  assert.equal(errors.length,1);
  assert.equal(errors[0].error,broken);
  assert.deepEqual([errors[0].operation,errors[0].id,errors[0].details.fileName],["files import","r1","broken.blif"]);
  assert.equal(errors[0].details.documentId,"document:Single");
  assert.equal(errors[0].details.documentVersion,2);
});

test("mixed import skips attachments when every requested design failed", async () => {
  const {run,requests} = importer(() => { throw Error("bad Verilog"); });
  const files = [{name:"a.rpt",text:"timing"},{name:"broken.v",text:"broken"}];
  await assert.rejects(run({name:"files import",opts:{},files}), e => {
    assert.equal(e.code,"IMPORT_FAILED");
    assert.deepEqual(e.files.map(r=>r.status),["skipped","failed"]);
    return true;
  });
  assert.equal(requests.length,1);
});

test("pure AIG multi-open appends only after the first successful open", async () => {
  const {run,requests} = importer(text => { if (text==="broken") throw Error("broken"); });
  const files = [{name:"bad.blif",text:"broken"},{name:"one.blif",text:"one"},{name:"two.dot",text:"two"}];
  const r = await run({name:"files import",id:"r1",opts:{},files});
  assert.equal(r.partial,true);
  assert.deepEqual(requests.map(x=>x.append),[false,false,true]);
});

test("side- and domain-mismatched imports fail before invoking workspace operations", async () => {
  const {run,requests} = importer(() => {}, "AIG");
  const files=[{name:"timing.rpt",text:"timing"}];
  await assert.rejects(run({name:"timing open",opts:{side:"A"},files}),{code:"INVALID_SIDE"});
  await assert.rejects(run({name:"timing open",opts:{},files}),{code:"DOMAIN_MISMATCH"});
  assert.deepEqual(requests,[]);
  assert.equal(compareSideFor("Compare","B",true),"right");
});

test("design add rejects a mixed-domain selection before changing the existing netlist", async () => {
  const {run, requests} = importer(() => {});
  const files = [{name:"extra.v", text:"module extra; endmodule"}, {name:"eco.blif", text:".model eco"}];
  await assert.rejects(run({id:"mix", name:"design add", opts:{}, files}), error => {
    assert.equal(error.code, "DOMAIN_MISMATCH");
    assert.deepEqual(error.files, files.map(({name}) => ({name, status:"uncommitted"})));
    return true;
  });
  assert.deepEqual(requests, []);
});

test("superseding a remote Liberty batch cancels its read and preserves the newer document", async () => {
  const lifetimes = createImportRequests();
  let receivedSignal, release;
  const paused = new Promise(resolve => {release = resolve;});
  const {run, requests, errors} = importer(async (_text, options) => {
    if (options.kind === "liberty") {
      receivedSignal = options.signal;
      await paused;
    }
  }, "Single", lifetimes);
  const pending = run({id:"old-batch", name:"files import", opts:{}, files:[
    {name:"cells.lib", text:"library(cells) {}"}, {name:"old.v", text:"module old; endmodule"}
  ]});
  const newer = lifetimes.begin();
  release();
  await assert.rejects(pending, {name:"AbortError"});
  assert.equal(receivedSignal.aborted, true);
  assert.equal(newer.isCurrent(), true);
  assert.deepEqual(requests.map(({name}) => name), ["cells.lib"]);
  assert.deepEqual(errors, []);
});

test("private browsing with denied sessionStorage leaves an unpaired local workspace usable", async () => {
  const w={location:{hash:""},get sessionStorage(){throw Error("Storage denied");}};
  await bindRemoteWorkbench({windowTarget:w,document:{}});
});

test("remote Cell Config keeps old values on a conflict and waits for refresh before replying", async () => {
  let stored = {kind:"old"}, resume;
  const refreshed = new Promise(resolve => {resume=resolve;});
  const incoming = {kind:"new"};
  const apply=createRemoteCellConfigImport({
    useCases:{prepareImport:() => ({conflicts:["BUF"],bundle:incoming}), commitImport:p => p.bundle},
    read:()=>stored, write:v=>{stored=v;}, refresh:()=>refreshed
  });
  await assert.rejects(apply({text:""},{}) ,e=>e.code==="CELL_CONFIG_CONFLICT"&&e.candidates.includes("BUF"));
  assert.equal(stored.kind,"old");
  let done=false;
  const result=apply({text:""},{"on-conflict":"replace"}).then(()=>{done=true;});
  await Promise.resolve();
  assert.equal(stored,incoming);assert.equal(done,false);
  resume();await result;assert.equal(done,true);
});

test("first AIG batch publishes one complete list after its first layout commits", async () => {
  const rendered = [];
  const request={signal:new AbortController().signal};
  const collection = createAigCollection({
    render:items=>rendered.push(items.map(i=>i.name)),validate(){},
    activate:async (source,_restore,token) => collection.commit(source,undefined,token)
  });
  const files=[{name:"one",text:"one"},{name:"two",text:"two"}];
  const result=await collection.add(files,request);
  assert.deepEqual(rendered,[["one","two"]]);
  assert.deepEqual(result.added.map(x=>x.name),["one","two"]);
});

test("AIG capacity and first-layout failures identify the failed file without publishing a partial batch", async () => {
  const layoutError = new Error("First layout failed");
  let validations = 0;
  const collection = createAigCollection({
    validate(){validations++;}, activate:async () => {throw layoutError;},
    render(){assert.fail("Failed batches cannot update the graph picker");}
  });
  const request = createImportRequests().begin();
  const inputs = Array.from({length:collectionLimits.graphs + 1}, (_, i) => ({name:i + ".dot", text:"g"}));
  await assert.rejects(collection.add(inputs, request), error => {
    assert.equal(error.code, "COLLECTION_LIMIT");
    assert.deepEqual(error.files.filter(row => row.status === "failed"), [{name:inputs.at(-1).name, status:"failed"}]);
    assert.ok(error.files.slice(0, -1).every(row => row.status === "uncommitted"));
    return true;
  });
  assert.equal(validations, 0);
  await assert.rejects(collection.add(inputs.slice(0, 2), request), error => {
    assert.equal(error, layoutError);
    assert.deepEqual(error.files, [{name:"0.dot", status:"failed"}, {name:"1.dot", status:"uncommitted"}]);
    return true;
  });
  assert.deepEqual(collection.list(), []);
});

for (const [field,before,after] of [
  ["documentId","top","extra"], ["occurrence",["left"],["right"]],
  ["pair",["left","right"],["left","other"]], ["activeSide","A","B"]
]) test("page tolerates retry and rejects changes to "+field+" during grant", async t => {
  const actions = [], jobs = ["cancelled", "valid", "superseded", "graph-info"], loaded = [], waits = [], acknowledged = [], logs = [];
  let graph = false, targetValue = before;
  const response = (body, ok = true) => ({ ok, json:async () => body });
  let inputs = 0, acks = 0;
  const wait = fn => { queueMicrotask(fn); return 0; };
  const w = {
    sessionStorage:{ getItem:() => null, setItem() {} },
    location:{hash:"#ngb=token"}, history:{replaceState(){}}, performance:{getEntriesByType:()=>[]},
    setTimeout:wait, setInterval:()=>0, clearInterval(){}, addEventListener(){},
    async fetch(path, options) {
      const b = JSON.parse(options.body);
      actions.push([b.op, b.id]);
      if (actions.length > 32) return response({error:{code:"PAGE_UNAVAILABLE", message:"Test request limit"}}, false);
      if (b.op === "join") return response({page:"p1", resume:"r", connection:"c"});
      if (b.op === "poll") {
        waits.push(b.waitMs);
        const id = jobs.shift();
        if (id === "graph-info") {
          graph = true;
          return response({job:{id, name:"design info", opts:{}, args:[]}});
        }
        return id ? response({job:{id, name:"timing open", opts:{}, args:["sample.rpt"], hasInputs:true}}) :
          response({error:{code:"PAGE_UNAVAILABLE", message:"Closed"}}, false);
      }
      if (b.op === "inputs") {
        if (b.id === "cancelled") return response({error:{code:"CANCELLED", message:"Cancelled"}}, false);
        if (++inputs === 1) throw Error("Connection lost during transfer");
        return response({files:[{name:"sample.rpt", text:"data"}]});
      }
      if (b.op === "grant") {
        if (b.id === "superseded") targetValue = after;
        return response({granted:true});
      }
      if (b.op === "ack") {
        acknowledged.push(b.error?.code || b.result?.files?.[0]?.status || b.result);
        if (++acks === 1) throw Error("Lost acknowledgement");
        return response({status:"committed"});
      }
      throw Error("Unexpected request " + b.op);
    }
  };
  // Minimal browser chrome for a session that never opens the file chooser.
  const element = { append(){}, add(){}, addEventListener(){}, querySelector:() => element };
  const document = {body:element, createElement:() => element, getElementById:() => element};
  const originalOption = Object.getOwnPropertyDescriptor(globalThis, "Option");
  Object.defineProperty(globalThis, "Option", {value:class {}, configurable:true});
  t.after(() => { if (originalOption) Object.defineProperty(globalThis,"Option",originalOption); else delete globalThis.Option; });
  await bindRemoteWorkbench({
    document, windowTarget:w, domainWorkbench:{
      context:()=>graph ? {sourceLabel:"top.blif",graphId:"g2",documentId:"aig-2",sourceRevision:1} : {},
      graphs:{list:()=>[{id:"g1"}, {id:"g2"}]}
    },
    readNetlist:()=>({mode:field === "pair" || field === "activeSide" ? "Compare" : "Single", documentId:"top", [field]:targetValue}), priority:getQuickInputPriority, importRequests:createImportRequests(),
    loadText:async text=>{ loaded.push(text); return "timing"; }, logProcess:(...args)=>logs.push(args), setStatus(){}
  });
  assert.deepEqual(loaded,["data"]);
  assert.deepEqual(waits,[5000,5000,5000,5000,5000]);
  assert.deepEqual(acknowledged.slice(0,3),["committed","committed","STALE_DOCUMENT"]);
  assert.deepEqual([acknowledged[3]?.graphCount, acknowledged[3]?.graphId], [2, "g2"]);
  const stale = logs.filter(row => row[3]?.code === "STALE_DOCUMENT").map(row => row[3]);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].operation, "timing open");
  assert.equal(stale[0].requestId, "superseded");
  assert.equal(stale[0].documentId, "top");
  assert.equal(stale[0].error.code, "STALE_DOCUMENT");
  assert.deepEqual(actions.filter(([op]) => ["inputs","grant","ack"].includes(op)),[
    ["inputs","cancelled"],["inputs","valid"],["inputs","valid"],["grant","valid"],["ack","valid"],["ack","valid"],
    ["inputs","superseded"],["grant","superseded"],["ack","superseded"],["grant","graph-info"],["ack","graph-info"]
  ]);
});
