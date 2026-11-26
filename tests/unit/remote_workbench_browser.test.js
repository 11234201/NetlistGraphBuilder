import test from "node:test";
import assert from "node:assert/strict";
import { createRemoteFileImport, compareSideFor } from "../../src/app/remote_file_import.js";
import { bindRemoteWorkbench } from "../../src/app/remote_workbench.js";
import { createRemoteCellConfigImport } from "../../src/app/remote_cell_config.js";
import { createAigCollection } from "../../src/app/aig_collection.js";
import { collectionLimits } from "../../src/persistence/aig_collection_storage.js";
import { getQuickInputPriority } from "../../src/app/quickInput.js";
import { createImportRequests } from "../../src/application/import_requests.js";
import { makePickerDocument, descendants, eventOf } from "../helpers/server_picker_dom.js";

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
    ["design.v",false],["more.v",true],["timing.rpt",false],["broken.blif",false]
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

test("unreadable Verilog inputs keep Timing off the previous document and allow independent AIGs", async () => {
  for (const name of ["expected.sv", "unknown.txt"]) {
    const {run, requests} = importer(() => {});
    const files = [{name, error: {code: "ENOENT", message: "missing design"}},
      {name: "new.timing", text: "point at rt slack\na 2 3 1"}, {name: "independent.blif", text: "AIG"}];
    if (name === "expected.sv") files.push({name: "independent.level", text: "a 3"});
    const result = await run({name: "files import", opts: {}, files});
    assert.deepEqual(requests.map(row => row.name), ["independent.blif"]);
    assert.deepEqual(result.files.map(row => row.status),
      name === "expected.sv" ? ["failed", "skipped", "committed", "committed"] : ["failed", "skipped", "committed"]);
    assert.equal(result.files[0].error.code, "ENOENT");
  }
});

test("remote Level pairs commit together and report the offending attachment once", async () => {
  const levelError = Object.assign(new Error("unknown Level point"), {code:"aig.level-unknown-point"});
  const {run, errors} = importer((text, options) => {
    assert.equal(options.levelFile.text, text + " level");
    if (text === "bad") {
      options.onFailureContext({fileName:options.levelFile.name, operation:"aig.level.import", line:2});
      throw levelError;
    }
  });
  const files = [
    {name:"bad.level", text:"bad level"}, {name:"good.blif", text:"good"},
    {name:"bad.dot", text:"bad"}, {name:"good.level", text:"good level"}
  ];
  const result = await run({name:"files import", id:"pair", opts:{}, files});
  assert.deepEqual(result.files.map(f => f.status), ["failed","committed","uncommitted","committed"]);
  assert.equal(errors.length,1);
  assert.equal(errors[0].error,levelError);
  assert.equal(errors[0].details.fileName,"bad.level");
  assert.equal(errors[0].details.line,2);
});

test("unreadable member prevents a remote pair from changing the active AIG", async () => {
  const {run, requests} = importer(() => {}, "AIG");
  for (const name of ["bad.blif", "unknown.txt"]) {
    const files = [{name, error:{code:"ENOENT",message:"Missing"}}, {name:"inputs.level",text:"a 3"}];
    await assert.rejects(run({name:"files import", opts:{}, files}), e => e.files.every(f=>f.status !== "committed"));
  }
  assert.deepEqual(requests,[]);
});

test("ambiguous remote Level pairs return an ordered receipt identifying the conflicting selection", async () => {
  const {run, requests, errors} = importer(() => {});
  const files = [{name:"core.level", text:"a 1"}, {name:"core.blif", text:"graph"}, {name:"core.level", text:"a 2"}];
  await assert.rejects(run({name:"files import", id:"ambiguous", opts:{}, files}), error => {
    assert.equal(error.code, "AMBIGUOUS_LEVEL_TARGET");
    assert.deepEqual(error.files.map(row => [row.name,row.status]), [
      ["core.level","uncommitted"], ["core.blif","uncommitted"], ["core.level","failed"]
    ]);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].error, error);
    assert.equal(errors[0].details.operation, "pair-aig-level");
    return true;
  });
  assert.deepEqual(requests, []);
});

test("same-name remote graph and Level files report the member whose validation failed", async () => {
  for (const kind of ["aig","level"]) {
    const original = Object.assign(new Error("invalid input"), {code:kind === "aig" ? "blif.cover-value" : "aig.level-row"});
    const {run, errors} = importer((_text, options) => {
      options.onFailureContext({fileName:"report.txt", operation:kind === "level" ? "aig.level.import" : "aig.import", line:2});
      throw original;
    });
    const files = [{name:"report.txt", text:".model g"}, {name:"report.txt", text:"point at_level\na 5"}];
    await assert.rejects(run({name:"files import", opts:{}, files}), error => {
      assert.equal(error.code, "IMPORT_FAILED");
      assert.deepEqual(error.files.map(row => [row.kind,row.status]),
        kind === "aig" ? [["aig","failed"],["level","uncommitted"]] : [["aig","uncommitted"],["level","failed"]]);
      return true;
    });
    assert.equal(errors[0].details.kind, kind);
    assert.equal(errors[0].error, original);
  }
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
  const element = { append(){}, add(){}, setAttribute(){}, addEventListener(){}, querySelector:() => element };
  const document = {body:element, createElement:() => element, getElementById:() => element};
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

async function untilMicrotask(predicate, description) {
  for (let turn = 0; turn < 500; turn++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("Did not settle: " + description);
}

// Exercise the real picker, import actor and receipt bridge against a minimal host queue.
// The second import can fail before enqueueing or lose its HTTP response after enqueueing.
async function pickerBridge(t, retryFailure) {
  const dom = makePickerDocument(), chrome = new Map(), listeners = new Map();
  const jobs = new Map(), receipts = new Map(), queue = [], loaded = [], attempts = [], logs = [];
  let waitingPoll, delayedJob, importCalls = 0, uuid = 0, revision = 1, repaired = false;
  const response = (body, ok = true) => ({ok, json:async () => body});
  dom.document.getElementById = id => {
    if (!chrome.has(id)) {
      const node = dom.document.createElement("div");
      const popover = dom.document.createElement("div");
      popover.className = "toolbar-menu-popover";
      node.append(popover); chrome.set(id, node);
    }
    return chrome.get(id);
  };
  function enqueue(job) {
    if (waitingPoll) { const resolve = waitingPoll; waitingPoll = null; resolve(response({job})); }
    else queue.push(job);
  }
  const windowTarget = {
    sessionStorage:{getItem:() => null, setItem() {}},
    location:{hash:"#ngb=token", pathname:"/", search:""},
    history:{replaceState() {}}, performance:{getEntriesByType:() => []},
    crypto:{randomUUID:() => "picker-retry-" + ++uuid},
    setTimeout:callback => { queueMicrotask(callback); return 0; },
    setInterval:() => 0, clearInterval() {},
    addEventListener:(name, handler) => listeners.set(name, handler),
    async fetch(_url, options) {
      const body = JSON.parse(options.body);
      if (body.op === "join") return response({page:"p1", resume:"r", connection:"c"});
      if (body.op === "list") return response({path:"/work", roots:["/work"], number:1, total:2,
        entries:["good.v", "bad.v"].map(name => ({name, handle:"ngb-file:" + name}))});
      if (body.op === "poll") {
        if (queue.length) return response({job:queue.shift()});
        return new Promise(resolve => { waitingPoll = resolve; });
      }
      if (body.op === "import") {
        importCalls++;
        if (importCalls === 2 && retryFailure === "host")
          return response({error:{code:"ACCESS_DENIED", message:"host rejected import"}}, false);
        const id = body.id || "host-import-" + importCalls;
        const job = {id, name:body.argv.slice(0, 2).join(" "), args:[], opts:{}, hasInputs:true,
          handles:body.argv.slice(2)};
        jobs.set(id, job);
        if (importCalls === 2 && retryFailure === "network") {
          delayedJob = job;
          throw Object.assign(new Error("connection lost after enqueue"), {code:"ECONNRESET"});
        }
        enqueue(job);
        return response({requestId:id, status:"queued"});
      }
      if (body.op === "inputs") return response({files:jobs.get(body.id).handles.map(handle => {
        const name = handle.slice("ngb-file:".length);
        return {name, text:name === "bad.v" && !repaired ? "broken" : "module valid; endmodule"};
      })});
      if (body.op === "grant") return response({granted:true});
      if (body.op === "status") return response(receipts.get(body.id) || {requestId:body.id, status:"executing"});
      if (body.op === "ack") {
        receipts.set(body.id, {requestId:body.id, status:body.error ? "failed" : "committed", result:body.result, error:body.error});
        return response({status:"committed"});
      }
      if (body.op === "leave" || body.op === "pulse") return response({});
      throw new Error("Unexpected host operation " + body.op);
    }
  };
  const binding = bindRemoteWorkbench({document:dom.document, windowTarget,
    domainWorkbench:{context:() => ({}), graphs:{list:() => []}},
    readNetlist:() => ({mode:"Single", documentId:"document:1", sourceRevision:revision, source:"current.v"}),
    priority:getQuickInputPriority, importRequests:createImportRequests(),
    loadText:async (text, options) => {
      attempts.push({name:options.label, append:options.append});
      if (text === "broken") throw Object.assign(new Error("invalid Verilog"), {code:"INVALID_INPUT"});
      if (!options.append) loaded.length = 0;
      loaded.push(options.label); revision++;
      return "netlist";
    },
    logProcess:(...args) => logs.push(args), setStatus() {}
  });
  t.after(async () => {
    listeners.get("pagehide")?.({});
    waitingPoll?.(response({})); waitingPoll = null;
    await binding;
  });
  await untilMicrotask(() => chrome.get("serverFiles")?.onclick, "pairing the picker");
  await chrome.get("serverFiles").onclick();
  for (const checkbox of descendants(dom.control("entries")).filter(node => node.type === "checkbox")) {
    checkbox.checked = true; checkbox.onchange(eventOf("change"));
  }
  return {...dom, loaded, attempts, receipts, logs, jobs,
    repair:() => { repaired = true; }, importCalls:() => importCalls,
    releaseEnqueued:() => { assert.ok(delayedJob); enqueue(delayedJob); delayedJob = null; }};
}

test("a lost HTTP response with a network code keeps retry policy for the already enqueued UI import", async t => {
  const h = await pickerBridge(t, "network");
  await h.control("submit").onclick();
  assert.deepEqual(h.loaded, ["good.v"]);
  h.repair();
  await h.control("submit").onclick();
  assert.match(h.control("status").textContent, /connection lost/);
  h.releaseEnqueued();
  await untilMicrotask(() => h.receipts.has("picker-retry-1"), "the enqueued retry receipt");
  assert.deepEqual(h.loaded, ["good.v", "bad.v"]);
  assert.deepEqual(h.attempts.at(-1), {name:"bad.v", append:true});
  assert.equal(h.importCalls(), 2);
});

test("an explicit host rejection does not import files and permits a later UI retry", async t => {
  const h = await pickerBridge(t, "host");
  await h.control("submit").onclick();
  h.repair();
  await h.control("submit").onclick();
  assert.match(h.control("status").textContent, /host rejected/);
  assert.deepEqual(h.loaded, ["good.v"]);
  assert.equal(h.jobs.size, 1, "the rejected command never entered the actor queue");
  await h.control("submit").onclick();
  assert.deepEqual(h.loaded, ["good.v", "bad.v"]);
  assert.deepEqual(h.attempts.at(-1), {name:"bad.v", append:true});
  assert.equal(h.importCalls(), 3);
});

test("an explicit batch failure carries its recovery context through the host receipt to the UI", async t => {
  const h = await pickerBridge(t);
  h.control("action").value = "design open";
  h.control("action").onchange(eventOf("change"));
  await h.control("submit").onclick();
  const receipt = h.receipts.get("host-import-1");
  assert.equal(receipt.error.code, "INVALID_INPUT");
  assert.ok(receipt.error.continuation);
  assert.equal(receipt.error.targetContext.documentVersion, receipt.error.continuation.documentVersion);
  assert.match(h.control("selection-count").textContent, /1 file/);
  h.repair();
  await h.control("submit").onclick();
  assert.deepEqual(h.loaded, ["good.v", "bad.v"]);
  assert.deepEqual(h.attempts.at(-1), {name:"bad.v", append:true});
});
