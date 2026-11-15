import assert from "node:assert/strict";
import test from "node:test";
import { createAppState, saveModuleWorkspace, restoreModuleWorkspace, saveCompareWorkspace, restoreCompareWorkspace } from "../../src/app/appState.js";
import { createTestViewBridges } from "../helpers/view_session_bridges.js";
import { createLegacyPort } from "../../src/app/legacy_port.js";
import { SINGLE_NAVIGATION_FIELDS, COMPARE_NAVIGATION_FIELDS } from "../../src/app/view_navigation_import.js";
import { DEFAULT_LAYOUT_POLICY } from "../../src/layout/layoutPolicy.js";
import { parseVerilog } from "../../src/parser/verilogParser.js";
import { buildWorkspaceGraph } from "../../src/domains/netlist/netlist_graph_projection.js";
import { applyLayoutGoldenState } from "../../src/app/layoutGoldenImport.js";
import { getLayoutGoldenState } from "../../src/domains/netlist/layout_golden.js";
import { normalizeViewQuery } from "../../src/contracts/view_query.js";
import { createSingleWorkspaceInput } from "../../src/app/workspace_inputs.js";
import { resolveCompareWorkspaceInputs } from "../../src/app/compareWorkspace.js";
import { createHistoryController } from "../../src/app/history_controller.js";
import { createViewHistoryEntry } from "../../src/app/viewHistory.js";
import { createModuleNavigationController } from "../../src/app/module_navigation_controller.js";

function setup() {
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  state.document = { documentId: "d" };
  state.design = parseVerilog("module top(input a, output y); BUF \\u/0  (.A(a), .Y(y)); endmodule module peer(input a, output y); INV other (.A(a), .Y(y)); endmodule");
  state.currentModule = state.design.modules[0];
  state.fullGraph = state.graph = buildWorkspaceGraph(state.currentModule);
  state.compare.leftModuleName = "top";
  state.compare.rightModuleName = "peer";
  state.compare.fullGraphs = { left: state.fullGraph, right: buildWorkspaceGraph(state.design.modules[1]) };
  const bridges = createTestViewBridges(state);
  return { state, ...bridges, node: state.fullGraph.nodes.find((node) => node.kind === "cell") };
}

test("commands and computation never import stale Single navigation projections", () => {
  const { state, singleViewSession: bridge, node } = setup();
  const ref = bridge.objectRefForNode(node);
  bridge.dispatch({ type: "focus.set", objectRef: ref });
  bridge.dispatch({ type: "selection.set", objectRef: ref });
  const before = bridge.sessions.require("single:primary");
  // Deliberately bypass the UI port to prove projections are no longer a source.
  state.focusedRootNodeIds = [];
  state.focusedRootRefs = [];
  state.activeFocusedRootNodeId = null;
  state.selectedNodeId = null;
  state.selectedNet = "stale";
  bridge.dispatch({ type: "viewport.set", viewport: { x: 1, y: 2, scale: 1 } });
  assert.equal(bridge.sessions.require("single:primary").computationRevision, before.computationRevision);
  assert.deepEqual(state.focusedRootNodeIds, [node.id]);
  assert.equal(state.selectedNodeId, node.id);
  assert.equal(state.selectedNet, null);
  assert.deepEqual(bridge.beginComputation().focusedRootRefs, before.focusedRootRefs);
});

test("controller navigation projections reject assignment, reflection and nested writes", () => {
  const { state, singleViewSession, compareViewSessions, node } = setup();
  singleViewSession.dispatch({ type: "focus.set", objectRef: singleViewSession.objectRefForNode(node) });
  compareViewSessions.replaceRoots("left", [node.id]);
  const port = createLegacyPort(() => state, [...SINGLE_NAVIGATION_FIELDS, "compare"], {
    writable: true, readOnly: SINGLE_NAVIGATION_FIELDS,
    nestedFields: { compare: COMPARE_NAVIGATION_FIELDS }, nestedReadOnly: { compare: COMPARE_NAVIGATION_FIELDS }
  });
  assert.throws(() => { port.selectedNodeId = "stale"; }, TypeError);
  for (const key of ["viewMode", "coneDepth", "faninDepth", "fanoutDepth"]) {
    assert.throws(() => { port[key] = "stale"; }, TypeError, key);
    assert.throws(() => Object.defineProperty(port, key, { value: "stale" }), TypeError, key);
  }
  assert.throws(() => { port.focusedRootNodeIds.push("stale"); }, TypeError);
  assert.throws(() => { port.compare.selectedName = "stale"; }, /mutation/);
  assert.throws(() => { port.compare.focusedRootNodeIds.left = []; }, TypeError);
  assert.throws(() => Object.defineProperty(port.compare, "selectedSide", { value: "right" }), /mutation/);
  assert.deepEqual(state.focusedRootNodeIds, [node.id]);
});

test("query commands and workspace requests never read stale legacy modes or depths", () => {
  const { state, singleViewSession: bridge } = setup();
  bridge.importQuery({ viewMode: "search-first", coneDepth: 6, faninDepth: 0, fanoutDepth: 8 });
  const expected = bridge.readQuery();
  const before = bridge.sessions.require("single:primary");
  Object.assign(state, { viewMode: "whole", coneDepth: 1, faninDepth: 99, fanoutDepth: 99 });
  const input = createSingleWorkspaceInput(state, null, bridge.readQuery());
  assert.deepEqual(normalizeViewQuery(input), expected);
  bridge.dispatch({ type: "viewport.set", viewport: { x: 2, y: 3, scale: 1 } });
  assert.equal(bridge.sessions.require("single:primary").computationRevision, before.computationRevision);
  assert.deepEqual(normalizeViewQuery(state), expected);
  state.viewMode = "focused";
  state.faninDepth = 2;
  assert.deepEqual(normalizeViewQuery(bridge.beginComputation()), expected);
});

test("startup query imports survive document opening and reset preserves canonical depths", () => {
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  const { singleViewSession: bridge } = createTestViewBridges(state);
  bridge.importQuery({ faninDepth: 0, fanoutDepth: 7, coneDepth: 5 });
  Object.assign(state, { faninDepth: 99, fanoutDepth: 99, coneDepth: 99 });
  state.currentModule = { name: "large" };
  bridge.importQuery({ viewMode: "search-first" });
  assert.deepEqual(bridge.readQuery(), { viewMode: "search-first", faninDepth: 0, fanoutDepth: 7, coneDepth: 5 });
  bridge.resetNavigation();
  state.currentModule = { name: "next" };
  assert.deepEqual(normalizeViewQuery(bridge.beginComputation()), { viewMode: "whole", faninDepth: 0, fanoutDepth: 7, coneDepth: 5 });
});

test("resolving pending roots cannot replay an older imported mode or depth", () => {
  const { state, singleViewSession: bridge, node } = setup();
  const graph = state.fullGraph;
  state.fullGraph = null;
  bridge.importNavigation({ viewMode: "fanin", faninDepth: 1, fanoutDepth: 2, focusedRootNodeIds: [node.id] });
  assert.equal(bridge.readQuery().viewMode, "focused");
  bridge.dispatch({ type: "view.mode.set", viewMode: "search-first" });
  bridge.dispatch({ type: "view.depths.set", faninDepth: 0, fanoutDepth: 9 });
  const before = bridge.sessions.require("single:primary");
  state.fullGraph = graph;
  const resolved = bridge.refreshNavigation();
  assert.equal(resolved.focusedRootRefs[0].localId, "u/0");
  assert.deepEqual(normalizeViewQuery(resolved), normalizeViewQuery(before));
  assert.equal(resolved.computationRevision, before.computationRevision);
});

test("query normalization preserves zero depths, bounds cone depth and imports without spurious invalidation", () => {
  const { singleViewSession: bridge } = setup();
  bridge.importQuery({ faninDepth: 0, fanoutDepth: 120.5, coneDepth: 0 });
  const before = bridge.sessions.require("single:primary");
  assert.deepEqual(bridge.readQuery(), { viewMode: "whole", faninDepth: 0, fanoutDepth: 99, coneDepth: 1 });
  assert.equal(bridge.importQuery({}), before);
  assert.equal(bridge.dispatch({ type: "view.coneDepth.set", coneDepth: 0 }).session, before);
  const changed = bridge.dispatch({ type: "view.coneDepth.set", coneDepth: 4.8 });
  assert.equal(changed.session.coneDepth, 4);
  assert.equal(changed.session.computationRevision, before.computationRevision + 1);
  assert.equal(changed.effects.query, true);
  assert.throws(() => bridge.importQuery({ faninDepth: NaN }), /finite/);
  assert.equal(bridge.readQuery().faninDepth, 0);
});

test("Compare explicitly imports effective output and Focused queries without reading legacy depths", () => {
  const { state, singleViewSession: single, compareViewSessions: compare, node } = setup();
  single.importQuery({ coneDepth: 5, faninDepth: 0, fanoutDepth: 7 });
  const options = { ...single.readQuery(), leftModule: state.design.modules[0], rightModule: state.design.modules[1],
    fullGraphs: state.compare.fullGraphs, outputName: "y", focusedRootNodeIds: { left: [node.id], right: [] } };
  const inputs = resolveCompareWorkspaceInputs(options);
  compare.importQuery(single.readQuery(), inputs);
  const left = compare.sessions.require("compare:left");
  const right = compare.sessions.require("compare:right");
  assert.deepEqual(normalizeViewQuery(left), { viewMode: "focused", coneDepth: 5, faninDepth: 0, fanoutDepth: 7 });
  assert.deepEqual(normalizeViewQuery(right), { viewMode: "focused", coneDepth: 5, faninDepth: 5, fanoutDepth: 0 });
  state.coneDepth = state.faninDepth = state.fanoutDepth = 99;
  assert.deepEqual(normalizeViewQuery(compare.beginComputation("right")), normalizeViewQuery(right));
  compare.importQuery(single.readQuery(), resolveCompareWorkspaceInputs({ ...options, outputName: null,
    focusedRootNodeIds: { left: [], right: [] }, leftModule: { cells: [{}, {}] }, searchFirstThreshold: 1 }));
  assert.equal(compare.sessions.require("compare:left").viewMode, "search-first");
  assert.equal(single.readQuery().viewMode, "whole", "Compare mode must not change Single mode");
});

test("module and Golden imports restore query settings through readonly controller projections", () => {
  const { state, singleViewSession: bridge, node } = setup();
  bridge.importNavigation({ viewMode: "focused", faninDepth: 0, fanoutDepth: 8, focusedRootNodeIds: [node.id] });
  saveModuleWorkspace(state, "top");
  bridge.importQuery({ viewMode: "whole", faninDepth: 3, fanoutDepth: 3 });
  const port = createLegacyPort(() => state, Object.keys(state), { writable: true, readOnly: SINGLE_NAVIGATION_FIELDS });
  restoreModuleWorkspace(port, "top", bridge.importNavigation);
  assert.deepEqual(bridge.readQuery(), { viewMode: "focused", faninDepth: 0, fanoutDepth: 8, coneDepth: 3 });
  const golden = getLayoutGoldenState(JSON.stringify({ kind: "netlist-layout-golden", version: 2, moduleName: "top",
    nodes: [{ id: node.id, x: 0, y: 0, width: 100, height: 60 }],
    layoutOptions: { display: { viewMode: "search-first", faninDepth: 2, fanoutDepth: 0, coneDepth: 7 } } }));
  applyLayoutGoldenState(port, golden, bridge.importNavigation);
  assert.deepEqual(bridge.readQuery(), { viewMode: "search-first", faninDepth: 2, fanoutDepth: 0, coneDepth: 7 });
  assert.deepEqual(state.focusedRootNodeIds, []);
});

for (const crossModule of [false, true]) {
  test(`Single history restores its query before one render, crossModule=${crossModule}`, () => {
    const { state, singleViewSession: bridge, node } = setup();
    bridge.importNavigation({ viewMode: "focused", faninDepth: 0, fanoutDepth: 8, coneDepth: 6,
      focusedRootNodeIds: [node.id] });
    const expected = bridge.readQuery();
    const entry = createViewHistoryEntry(state);
    bridge.importQuery({ viewMode: "whole", faninDepth: 9, fanoutDepth: 9, coneDepth: 9 });
    if (crossModule) {
      state.currentModule = state.design.modules[1];
      state.fullGraph = state.graph = buildWorkspaceGraph(state.currentModule);
    }
    let selections = 0;
    let renders = 0;
    const services = new Proxy({ singleViewSession: bridge,
      selectModule(name, options) {
        selections++;
        assert.deepEqual(options, { historyMode: "restore", deferRender: true });
        state.currentModule = state.design.modules.find((module) => module.name === name);
        state.fullGraph = state.graph = buildWorkspaceGraph(state.currentModule);
      },
      renderCurrentModuleGraph(options) {
        renders++;
        assert.equal(state.currentModule.name, entry.moduleName);
        assert.deepEqual(bridge.readQuery(), expected);
        assert.equal(state.restoringViewHistory, true);
        options.onCancelled();
      }
    }, { get: (target, key) => key in target ? target[key] : () => {} });
    const port = createLegacyPort(() => state, Object.keys(state), { writable: true, readOnly: SINGLE_NAVIGATION_FIELDS });
    createHistoryController({ state: port, services,
      elements: new Proxy({}, { get: (target, key) => target[key] ||= {} }) }).restoreViewHistoryEntry(entry);
    assert.equal(renders, 1);
    assert.equal(selections, Number(crossModule));
    assert.equal(state.restoringViewHistory, false);
  });
}

test("module navigation imports Search-first defaults and restores the saved module query", () => {
  const { state, singleViewSession: bridge, node } = setup();
  state.design.modules.push(parseVerilog("module big(input a, output y); wire n; BUF u1(.A(a),.Y(n)); BUF u2(.A(n),.Y(y)); endmodule").modules[0]);
  bridge.importNavigation({ viewMode: "focused", faninDepth: 0, fanoutDepth: 8, focusedRootNodeIds: [node.id] });
  const services = new Proxy({ singleViewSession: bridge, SEARCH_FIRST_NODE_THRESHOLD: 1,
    moduleHierarchyController: { render() {} },
    setSingleTransform: (viewport) => bridge.dispatch({ type: "viewport.set", viewport })
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  const port = createLegacyPort(() => state, Object.keys(state), { writable: true, readOnly: SINGLE_NAVIGATION_FIELDS });
  const controller = createModuleNavigationController({ state: port, services,
    elements: new Proxy({}, { get: (target, key) => target[key] ||= {} }) });
  controller.selectModule("big", { deferRender: true });
  assert.deepEqual(bridge.readQuery(), { viewMode: "search-first", faninDepth: 0, fanoutDepth: 8, coneDepth: 3 });
  bridge.importQuery({ viewMode: "whole", faninDepth: 5, fanoutDepth: 6 });
  controller.selectModule("top", { deferRender: true });
  assert.deepEqual(bridge.readQuery(), { viewMode: "focused", faninDepth: 0, fanoutDepth: 8, coneDepth: 3 });
});

test("legacy IDs wait for the destination graph and a newer explicit import wins", () => {
  const { state, singleViewSession: bridge, node } = setup();
  const destination = state.fullGraph;
  state.fullGraph = state.compare.fullGraphs.right;
  bridge.importNavigation({ focusedRootNodeIds: ["missing"], selectedNodeId: "missing" });
  bridge.importNavigation({ focusedRootNodeIds: [node.id, "net:a"], activeFocusedRootNodeId: "net:a", selectedNodeId: node.id });
  bridge.dispatch({ type: "viewport.set", viewport: { x: 5, y: 8, scale: 1.5 } });
  assert.deepEqual(state.focusedRootNodeIds, [node.id, "net:a"]);
  state.fullGraph = destination;
  const before = bridge.sessions.require("single:primary").computationRevision;
  const session = bridge.refreshNavigation();
  assert.equal(session.computationRevision, before, "resolving the same import must not invalidate its committed job");
  assert.equal(session.focusedRootRefs[0].localId, "u/0");
  assert.equal(session.activeFocusedRootRef.localId, "a");
  assert.equal(session.selectedObjectRef.localId, "u/0");
  assert.equal(state.selectedNodeId, node.id);
});

test("module and Golden restoration import roots through the real bridge before graph readiness", () => {
  const { state, singleViewSession: bridge, node } = setup();
  bridge.dispatch({ type: "focus.set", objectRef: bridge.objectRefForNode(node) });
  saveModuleWorkspace(state, "top");
  state.fullGraph = null;
  restoreModuleWorkspace(state, "top", bridge.importNavigation);
  assert.deepEqual(state.focusedRootNodeIds, [node.id]);
  const golden = getLayoutGoldenState(JSON.stringify({ kind: "netlist-layout-golden", version: 2, moduleName: "top",
    nodes: [{ id: node.id, x: 0, y: 0, width: 100, height: 60 }],
    layoutOptions: { display: { viewMode: "focused", focusedRootNodeIds: ["net:a"], activeFocusedRootNodeId: "net:a" } } }));
  applyLayoutGoldenState(state, golden, bridge.importNavigation);
  state.fullGraph = buildWorkspaceGraph(state.currentModule);
  bridge.refreshNavigation();
  assert.deepEqual(state.focusedRootNodeIds, ["net:a"]);
  assert.equal(bridge.sessions.require("single:primary").activeFocusedRootRef.kind, "net");
  bridge.dispatch({ type: "focus.clear" });
  bridge.refreshNavigation();
  assert.deepEqual(state.focusedRootNodeIds, [], "a completed import cannot resurrect cleared roots");
});

test("occurrence restore waits for its own graph and can return to the module definition", () => {
  const { state, singleViewSession: bridge, node } = setup();
  state.occurrenceContext = { occurrencePath: ["left"] };
  state.fullGraph = buildWorkspaceGraph(state.currentModule, { occurrencePath: ["left"] });
  bridge.importNavigation({ focusedRootNodeIds: [node.id], selectedNodeId: node.id });
  state.occurrenceContext = { occurrencePath: ["right"] };
  bridge.importNavigation({ focusedRootNodeIds: [node.id], selectedNodeId: node.id });
  state.fullGraph = buildWorkspaceGraph(state.currentModule, { occurrencePath: ["right"] });
  assert.deepEqual(bridge.refreshNavigation().selectedObjectRef.occurrencePath, ["right"]);
  state.occurrenceContext = null;
  bridge.importNavigation({ focusedRootNodeIds: [node.id], selectedNodeId: node.id });
  state.fullGraph = buildWorkspaceGraph(state.currentModule);
  assert.equal(bridge.refreshNavigation().selectedObjectRef.occurrencePath, undefined);
});

test("Compare viewport and computation preserve peer selection and the active inspector side", () => {
  const { state, compareViewSessions: bridge, node } = setup();
  bridge.replaceRoots("left", [node.id]);
  bridge.dispatch("right", { type: "selection.set", objectRef: bridge.objectRef("right", "cell", "other") });
  bridge.dispatch("left", { type: "selection.set", objectRef: bridge.objectRef("left", "cell", "u/0") });
  const before = bridge.sessions.require("compare:right");
  bridge.dispatch("right", { type: "viewport.set", viewport: { x: 8, y: 9, scale: 1 } });
  assert.equal(state.compare.selectedSide, "left");
  assert.equal(bridge.sessions.require("compare:right").computationRevision, before.computationRevision);
  assert.deepEqual(bridge.beginComputation("right").selectedObjectRef, before.selectedObjectRef);
  assert.deepEqual(state.compare.focusedRootNodeIds.left, [node.id]);
});

test("Compare archive import restores each side independently after graph replacement", () => {
  const { state, compareViewSessions: bridge, node } = setup();
  bridge.replaceRoots("left", [node.id]);
  bridge.replaceRoots("right", ["net:a"]);
  saveCompareWorkspace(state);
  const graphs = state.compare.fullGraphs;
  state.compare.fullGraphs = { left: null, right: null };
  restoreCompareWorkspace(state, "top", "peer", bridge.importNavigation);
  assert.deepEqual(state.compare.focusedRootNodeIds, { left: [node.id], right: ["net:a"] });
  state.compare.fullGraphs = graphs;
  bridge.refreshNavigation("left");
  bridge.refreshNavigation("right");
  assert.equal(bridge.sessions.require("compare:left").focusedRootRefs[0].localId, "u/0");
  assert.equal(bridge.sessions.require("compare:right").focusedRootRefs[0].kind, "net");
});
