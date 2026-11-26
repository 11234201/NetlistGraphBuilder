import test from "node:test";
import assert from "node:assert/strict";
import { createWorkbenchSearchScope } from "../../src/app/workbench_search_scope.js";
import { createCompareSearchNavigation } from "../../src/app/compare_search_navigation.js";
import { createSearchNavigationController } from "../../src/app/search_navigation_controller.js";
import { createCompareViewSessionBridge } from "../../src/app/compare_view_session_bridge.js";
import { createViewSessionStore } from "../../src/application/view_session_store.js";
import { createAppState } from "../../src/app/appState.js";
import { createHistoryController } from "../../src/app/history_controller.js";
import { DEFAULT_LAYOUT_POLICY } from "../../src/layout/layoutPolicy.js";
import { buildDesignSearchIndex, searchDesignIndex } from "../../src/search/designSearch.js";
import { createSearchControls } from "../../src/ui/searchControls.js";

const node = (name, kind = "cell") => ({ id: `${kind}:${name}`, kind, label: `Display ${name}`,
  ref: { localId: name }, x: 20, y: 30, width: 80, height: 40 });
function fixture({ visible = true, syncRoots = false } = {}) {
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  state.document = { documentId: "design:one", sourceRevision: 1 };
  state.currentModule = { name: "single" };
  state.currentSource = "module single; endmodule";
  state.graph = { moduleName: "single", nodes: [], edges: [] };
  const full = side => ({ moduleName: side === "left" ? "alpha" : "beta",
    nodes: [node("same"), node("branch/escaped[3]"), node("in", "input")],
    edges: [{ net: "wire[2]", points: [{ x: 30, y: 40 }, { x: 60, y: 40 }] }] });
  Object.assign(state.compare, { active: true, leftModuleName: "alpha", rightModuleName: "beta",
    fullGraphs: { left: full("left"), right: full("right") },
    focusedRootsSynchronized: syncRoots, workspaceIdentity: "ready" });
  state.compare.graphs = Object.fromEntries(["left", "right"].map(side => [side,
    visible ? state.compare.fullGraphs[side] : { moduleName: state.compare.fullGraphs[side].moduleName, nodes: [], edges: [] }]));
  const sessions = createViewSessionStore();
  let history;
  const bridge = createCompareViewSessionBridge({ state, sessions, getDocumentId: () => state.document.documentId,
    onDispatch: (...args) => history?.noteViewCommandDispatch(...args) });
  bridge.ensure("left"); bridge.ensure("right");
  const scope = createWorkbenchSearchScope({ readContext: () => ({ document: state.document, active: state.compare.active,
    modules: { left: state.compare.leftModuleName, right: state.compare.rightModuleName },
    graphs: state.compare.graphs, fullGraphs: state.compare.fullGraphs, singleGraph: state.graph,
    outputName: state.compare.outputName, syncRoots: state.compare.focusedRootsSynchronized,
    activeSide: state.compare.activeSide, syncSelection: state.compare.selectionSynchronized,
    syncViewport: state.compare.synchronized }), subscribe: sessions.subscribe });
  const calls = { selected: [], builds: [], status: [], logs: [] };
  history = createHistoryController({ state,
    elements: { moduleBackButton: {}, moduleForwardButton: {} },
    services: { persistSession() {} } });
  history.commitViewHistory();
  const navigation = createCompareSearchNavigation({ scope, readBridge: () => bridge,
    select(kind, name, focus, side, record) {
      calls.selected.push({ kind, name, focus, side, record });
      bridge.dispatch(side, { type: "selection.set", objectRef: bridge.objectRef(side, kind, name) });
      if (focus) bridge.dispatch(side, { type: "viewport.set", viewport: { x: 11, y: 22, scale: 2 } });
    },
    clearSelection: side => bridge.dispatch(side, { type: "selection.clear" }),
    rebuild: options => calls.builds.push(history.bindViewHistoryCallbacks(options, "onCommitted")),
    commitFocus: () => { state.compare.outputName = null; }, updateControls() {}, hideResults() {},
    setStatus: text => calls.status.push(text), logProcess: (...args) => calls.logs.push(args)
  });
  const controller = createSearchNavigationController({ state: new Proxy({}, { get() { assert.fail("Compare search touched Single state"); } }),
    elements: {}, services: {}, compareSearch: navigation });
  const entry = (side = "right", kind = "cell", name = "same") => scope.scopeSearchIndex([{
    id: `${kind}:${name}`, moduleName: side === "left" ? "alpha" : "beta", kind: kind === "cell" ? "instance" : kind,
    label: `Display ${name}`, target: { kind, name, ...(kind === "port" ? { direction: "input" } : {}) }
  }])[0];
  const activate = result => history.runViewHistoryTransaction({ label: "Locate search target" }, () => controller.activateSearchResult(result));
  const complete = (build = calls.builds.at(-1)) => {
    if (!build.pathCurrent() || build.signal.aborted) { build.onCancelled(); return; }
    build.commitPath(); state.compare.graphs = state.compare.fullGraphs;
    build.onCommitted(state.compare.graphs);
  };
  return { state, sessions, bridge, scope, calls, navigation, controller, history, entry, activate, complete };
}

test("Compare scope filters applied modules before the global result limit and preserves canonical refs", () => {
  const f = fixture();
  const module = name => ({ name, ports: [], nets: [], cells: [{ instance: "same", type: "BUF" }] });
  const index = buildDesignSearchIndex({ modules: [...Array.from({ length: 30 }, (_, i) => module(`other${i}`)), module("alpha"), module("beta")] });
  const scoped = f.scope.scopeSearchIndex(index);
  const hits = searchDesignIndex(scoped, "same");
  assert.deepEqual(hits.map(hit => [hit.side, hit.moduleName]), [["left", "alpha"], ["right", "beta"]]);
  assert.equal(hits[1].objectRef.localId, "same");
  assert.equal(hits[1].objectRef.unitId, "beta");
  assert.ok(f.scope.accepts(hits[1]));
  assert.equal(f.scope.readSearchGraph("alpha"), f.state.compare.graphs.left);
  assert.equal(f.scope.readSearchGraph("single"), undefined);
  f.state.compare.active = false;
  assert.equal(f.scope.scopeSearchIndex(index), index);
  assert.equal(f.scope.readSearchGraph("single"), f.state.graph);
  assert.equal(f.scope.accepts(hits[1]), false);
});

test("positioned Compare cells, ports and nets locate their own side without touching Single or building", () => {
  const f = fixture();
  for (const [side, kind, name] of [["right", "cell", "branch/escaped[3]"], ["left", "port", "in"], ["right", "net", "wire[2]"]]) {
    f.activate(f.entry(side, kind, name));
    assert.deepEqual(f.calls.selected.at(-1), { side, kind, name, focus: true, record: false });
    assert.equal(f.state.compare.activeSide, side);
  }
  assert.equal(f.calls.builds.length, 0);
  assert.equal(f.state.currentModule.name, "single");
  assert.equal(f.state.viewHistory.entries.length, 4);
  assert.deepEqual(f.state.viewHistory.entries.at(-1).compare.transforms.right, { x: 11, y: 22, scale: 2 });
});

test("Compare Focused candidates leave live roots and history untouched until successful commit", () => {
  const f = fixture({ visible: false });
  f.state.compare.outputName = "old-output";
  f.activate(f.entry());
  const build = f.calls.builds[0];
  assert.deepEqual(build.focusCandidate.focusedRootNodeIds, { left: [], right: ["cell:same"] });
  assert.equal(build.focusCandidate.outputName, null);
  assert.deepEqual(f.state.compare.focusedRootNodeIds, { left: [], right: [] });
  assert.equal(f.state.compare.outputName, "old-output");
  assert.equal(f.state.viewHistory.entries.length, 1);
  f.complete();
  assert.deepEqual(f.state.compare.focusedRootNodeIds, { left: [], right: ["cell:same"] });
  assert.equal(f.state.compare.outputName, null);
  assert.equal(f.calls.selected.at(-1).side, "right");
  assert.equal(f.state.viewHistory.entries.length, 2, "One successful search owns one compound history entry");
  assert.equal(f.state.viewHistory.entries[0].compare.selectedName, null);
  assert.equal(f.state.viewHistory.entries[1].compare.selectedName, "same");
  assert.deepEqual(f.state.viewHistory.entries[1].compare.transforms.right, { x: 11, y: 22, scale: 2 });
});

test("Compare search respects cell roots sync while net roots remain side-local", () => {
  const f = fixture({ visible: false, syncRoots: true });
  f.activate(f.entry());
  assert.deepEqual(f.calls.builds[0].focusCandidate.focusedRootNodeIds, { left: ["cell:same"], right: ["cell:same"] });
  f.complete();
  assert.deepEqual(f.state.compare.focusedRootNodeIds, { left: ["cell:same"], right: ["cell:same"] });
  const net = fixture({ visible: false, syncRoots: true });
  net.activate(net.entry("right", "net", "wire[2]"));
  assert.deepEqual(net.calls.builds[0].focusCandidate.focusedRootNodeIds, { left: [], right: ["net:wire[2]"] });
});

test("Compare candidate failures preserve live state and log the original error once", () => {
  const f = fixture({ visible: false });
  const original = f.state.compare.graphs;
  f.activate(f.entry());
  const error = new Error("candidate failed", { cause: new Error("worker cause") });
  f.calls.builds[0].onFailed(error); f.calls.builds[0].onFailed(error);
  assert.equal(f.calls.logs.length, 1);
  const details = f.calls.logs[0][3];
  assert.equal(details.error, error);
  assert.equal(details.error.cause.message, "worker cause");
  assert.equal(details.documentRevision, 1);
  assert.equal(details.requestId, 1);
  assert.deepEqual([details.operation, details.code, details.side, details.documentId],
    ["search.compare.navigate", "search.compare.failed", "right", "design:one"]);
  assert.equal(f.state.compare.graphs, original);
  assert.deepEqual(f.state.compare.focusedRootNodeIds.right, []);
  assert.equal(f.state.viewHistory.entries.length, 1);
  assert.equal(f.calls.selected.length, 0);
});

test("old Compare searches cannot commit after a newer selection, pair or document", () => {
  for (const change of [
    f => f.bridge.dispatch("left", { type: "selection.set", objectRef: f.bridge.objectRef("left", "cell", "same") }),
    f => f.bridge.dispatch("left", { type: "viewport.set", viewport: { x: 999, y: 0, scale: 1 } }),
    f => f.bridge.dispatch("left", { type: "focus.add", objectRef: f.bridge.objectRef("left", "cell", "same") }),
    f => f.bridge.setActiveSide("left"),
    f => { f.state.compare.selectionSynchronized = false; },
    f => { f.state.compare.rightModuleName = "replacement"; },
    f => { f.state.document = { documentId: "new-document", sourceRevision: 1 }; },
    f => { f.state.compare.active = false; }
  ]) {
    const f = fixture({ visible: false });
    f.activate(f.entry()); change(f);
    assert.equal(f.calls.builds[0].pathCurrent(), false);
    f.calls.builds[0].onFailed(new Error("old failure")); f.complete();
    assert.deepEqual(f.state.compare.focusedRootNodeIds.right, []);
    assert.equal(f.calls.selected.length, 0);
    assert.equal(f.calls.logs.length, 0);
  }
});

test("selection between candidate commit and presentation completion supersedes search centering", () => {
  const f = fixture({ visible: false });
  f.activate(f.entry());
  const build = f.calls.builds[0];
  build.commitPath(); f.state.compare.graphs = f.state.compare.fullGraphs;
  f.bridge.dispatch("left", { type: "selection.set", objectRef: f.bridge.objectRef("left", "cell", "same") });
  build.onCommitted(f.state.compare.graphs);
  assert.equal(f.calls.selected.length, 0);
  assert.equal(f.state.compare.selectedSide, "left");
});

test("Compare search construction keeps late composition services unevaluated", () => {
  const fail = () => assert.fail("Composition services are not ready during controller construction");
  assert.ok(createCompareSearchNavigation({ scope: { snapshot: fail }, readBridge: fail,
    select: fail, clearSelection: fail, rebuild: fail, commitFocus: fail,
    updateControls: fail, setStatus: fail, logProcess: fail, hideResults: fail }));
});

test("a second Compare search cancels the first candidate without phantom roots or history", () => {
  const f = fixture({ visible: false });
  f.activate(f.entry("right", "cell", "same"));
  f.activate(f.entry("right", "cell", "branch/escaped[3]"));
  assert.equal(f.calls.builds[0].signal.aborted, true);
  f.complete(f.calls.builds[0]); f.complete(f.calls.builds[1]);
  assert.deepEqual(f.state.compare.focusedRootNodeIds.right, ["cell:branch/escaped[3]"]);
  assert.equal(f.calls.selected.length, 1);
  assert.equal(f.state.viewHistory.entries.length, 2);
});

test("Show Path boundaries block outside hits and prevent roots sync outside the opposite path", () => {
  const f = fixture({ visible: false, syncRoots: true });
  f.state.compare.graphs.left.path = { searchKeys: new Set() };
  f.state.compare.graphs.right.path = { searchKeys: new Set([JSON.stringify(["cell", "same"])]) };
  f.activate(f.entry("right", "cell", "branch/escaped[3]"));
  assert.equal(f.calls.builds.length, 0);
  assert.match(f.calls.status.at(-1), /Outside Show Path/);
  f.activate(f.entry());
  assert.deepEqual(f.calls.builds[0].focusCandidate.focusedRootNodeIds, { left: [], right: ["cell:same"] });
});

test("stale scoped hits never fall through to Single, including after Compare exits", () => {
  const f = fixture();
  const hit = f.entry();
  f.state.compare.active = false;
  f.activate(hit);
  assert.equal(f.calls.selected.length, 0);
  assert.match(f.calls.status.at(-1), /scope changed/);
});

test("Compare search scope rejects old menu actions across revisions and applied pair changes", () => {
  const f = fixture();
  const original = f.entry();
  f.state.document = { ...f.state.document, sourceRevision: 2 };
  assert.equal(f.scope.accepts(original), false, "Same document id with a new revision invalidates old menu actions");
  const revised = f.entry();
  f.state.compare.rightModuleName = "another-module";
  assert.equal(f.scope.accepts(revised), false);
  f.state.compare.rightModuleName = "beta";
  assert.equal(f.scope.accepts(revised), false, "Returning to a prior pair cannot revive an observed stale scope");
});

test("unrouted Compare nets retain intentional selection without focusing nonexistent geometry", () => {
  const f = fixture({ visible: false });
  f.state.compare.graphs.right.unroutedNets = ["wire[2]"];
  f.activate(f.entry("right", "net", "wire[2]"));
  assert.equal(f.calls.selected.at(-1).focus, false);
  assert.equal(f.calls.builds.length, 0);
  assert.match(f.calls.status.at(-1), /not routed/);
});

test("search rows expose escaped A/B context and preserve side identity through keyboard and click", () => {
  const f = fixture();
  const results = [f.entry("left"), f.entry("right")];
  results[1].label = '<unsafe & label>';
  const selected = [];
  const elements = { searchInput: { value: "same" }, searchClearButton: {},
    searchResults: { innerHTML: "", hidden: false, querySelector: () => null } };
  const controls = createSearchControls({ elements, getIndex: () => [], search: () => results,
    onActivate: hit => selected.push(hit.side), onAdd() {}, onChange() {} });
  controls.handleSearchInput();
  assert.match(elements.searchResults.innerHTML, /data-search-side="right"/);
  assert.match(elements.searchResults.innerHTML, /B · instance/);
  assert.match(elements.searchResults.innerHTML, /&lt;unsafe &amp; label&gt;/);
  controls.handleSearchKeydown({ key: "ArrowDown", preventDefault() {} });
  controls.handleSearchKeydown({ key: "Enter", preventDefault() {} });
  controls.handleSearchResultClick({ target: { closest: selector => selector === "[data-search-index]"
    ? { dataset: { searchIndex: "0" } } : null } });
  assert.deepEqual(selected, ["right", "left"]);
});
