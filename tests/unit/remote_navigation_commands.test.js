import test from "node:test";
import assert from "node:assert/strict";
import { createRemoteRenderCompletion } from "../../src/app/remote_render_completion.js";
import { hierarchyRows, objectRecord, resolveNetlistObject } from "../../src/app/remote_object_queries.js";
import { objectRefToNodeId } from "../../src/domains/netlist/graph_object_refs.js";
import { resolveLayoutGoldenModule } from "../../src/app/layoutGoldenImport.js";
import { compareSelectionId } from "../../src/domains/netlist/compare_objects.js";
import { renderCompareSelectionHighlights } from "../../src/app/compare_selection_highlights.js";

test("command receipts await nested rendering without waiting on unrelated UI work", async () => {
  const tracker = createRemoteRenderCompletion();
  let first, follow, done = false;
  const request = tracker.run(() => {
    first = tracker.callbacks({onRendered:() => { follow = tracker.callbacks({},"onCommitted"); }});
    return "receipt";
  }).then(value => { done = true; return value; });
  const userRender = {onRendered() {}};
  assert.equal(tracker.callbacks(userRender),userRender);
  first.onRendered();
  await Promise.resolve();
  assert.equal(done,false);
  follow.onCommitted();
  assert.equal(await request,"receipt");
});

test("render receipts propagate the original error and distinguish cancellation", async () => {
  const tracker = createRemoteRenderCompletion();
  const cause = new Error("worker failed",{cause:new Error("missing scene")});
  await assert.rejects(tracker.run(() => { tracker.callbacks({}).onFailed(cause); }), err => err === cause);
  await assert.rejects(tracker.run(() => { tracker.callbacks({}).onCancelled(); }), {name:"AbortError"});
  await assert.rejects(tracker.run(() => { tracker.observe(Promise.reject(cause)); }), err => err === cause);
});

test("scoped object results enforce document revision, side, instance and canonical kind", () => {
  const graph = {nodes:[{id:"cell:escaped/name",kind:"cell",ref:{instance:"escaped/name"},label:"display"},
    {id:"input:escaped/name",kind:"input",ref:{name:"escaped/name"},label:"display"}],edges:[{net:"escaped/name"}]};
  const view = {documentId:"doc",sourceRevision:0,side:"left",moduleName:"leaf",full:graph,
    occurrence:{rootModuleName:"top",occurrencePath:["a/b"]}};
  const ref = objectRecord(view,resolveNetlistObject(view,"cell:escaped/name"));
  assert.equal(resolveNetlistObject(view,JSON.stringify(ref)).id,ref.id);
  assert.equal(resolveNetlistObject(view,"net:escaped/name").kind,"net");
  assert.throws(() => resolveNetlistObject(view,"display"),{code:"AMBIGUOUS_OBJECT"});
  assert.throws(() => resolveNetlistObject(view,{...ref,kind:"input"}),{code:"OBJECT_NOT_FOUND"});
  for (const scope of [{side:"B"},{documentId:"new"},{sourceRevision:1},{occurrencePath:["a","b"]}]) {
    assert.throws(() => resolveNetlistObject(view,{...ref,...scope}),{code:"STALE_REFERENCE"});
  }
  assert.throws(() => resolveNetlistObject({...view,sourceRevision:1},ref),{code:"STALE_REFERENCE"});
  assert.equal(objectRefToNodeId({kind:"net",localId:"escaped/name"},null),"net:escaped/name");
});

test("occurrence IDs preserve segment boundaries and Golden rejects a removed occurrence", () => {
  const leaf = path => ({rootModuleName:"top",moduleName:"leaf",canonicalOccurrencePath:path,children:[]});
  const ids = hierarchyRows([leaf(["a/b"]),leaf(["a","b"])]).map(row => row.id);
  assert.notEqual(...ids);
  const design = {modules:[{name:"top",cells:[{instance:"a/b",type:"leaf"}]},{name:"leaf",cells:[]}]};
  const imported = path => ({moduleName:"leaf",display:{occurrenceContext:{rootModuleName:"top",occurrencePath:path}}});
  assert.equal(resolveLayoutGoldenModule(design,imported(["a/b"])).name,"leaf");
  assert.throws(() => resolveLayoutGoldenModule(design,imported(["a","b"])),{code:"OCCURRENCE_NOT_FOUND"});
});

test("Compare preserves per-side selections while highlighting the homolog on the other canvas", () => {
  const graph = {nodes:["first","second"].map(name => ({id:"cell:"+name,kind:"cell",ref:{instance:name}}))};
  function mount() {
    const nodes = Object.fromEntries(graph.nodes.map(node => {
      const classes = new Set();
      return [node.id,{classes,classList:{
        add:value => classes.add(value),remove:(...values) => values.forEach(value => classes.delete(value))
      }}];
    }));
    return {nodes,querySelectorAll:() => Object.values(nodes),
      querySelector:selector => nodes[selector.match(/data-node-id="([^"]+)"/)[1]]};
  }
  const refs = {left:{kind:"cell",localId:"first"},right:{kind:"cell",localId:"second"}};
  const elements = {leftMount:mount(),rightMount:mount()};
  const compare = {selectedSide:"right",graphs:{left:graph,right:graph}};
  const render = () => renderCompareSelectionHighlights({compare,elements,readSelection:side => refs[side],escape:s => s});
  render();
  assert.equal(compareSelectionId(graph,refs.left),"cell:first");
  assert.equal(compareSelectionId(graph,refs.right),"cell:second");
  assert.deepEqual([...elements.leftMount.nodes["cell:first"].classes],["is-selected"]);
  assert.deepEqual([...elements.leftMount.nodes["cell:second"].classes],["is-compare-counterpart"]);
  refs.right = null;
  compare.selectedSide = null;
  render();
  assert.equal(compareSelectionId(graph,refs.right),null);
  assert.equal(elements.rightMount.nodes["cell:second"].classes.size,0);
  assert.equal(elements.leftMount.nodes["cell:second"].classes.size,0);
  assert.ok(elements.leftMount.nodes["cell:first"].classes.has("is-selected"));
});
