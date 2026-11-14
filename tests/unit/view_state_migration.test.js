import assert from "node:assert/strict";
import test from "node:test";
import {
  createAppState, saveModuleWorkspace, restoreModuleWorkspace,
  saveCompareWorkspace, restoreCompareWorkspace
} from "../../src/app/appState.js";
import { createSingleViewSessionBridge } from "../../src/app/single_view_session_bridge.js";
import { createCompareViewSessionBridge } from "../../src/app/compare_view_session_bridge.js";
import { createViewSessionStore } from "../../src/application/view_session_store.js";
import { createLegacyPort } from "../../src/app/legacy_port.js";
import { SINGLE_NAVIGATION_FIELDS, COMPARE_NAVIGATION_FIELDS } from "../../src/app/view_navigation_import.js";
import { DEFAULT_LAYOUT_POLICY, normalizeLayoutPolicy } from "../../src/layout/layoutPolicy.js";
import { parseVerilog } from "../../src/parser/verilogParser.js";
import { buildWorkspaceGraph } from "../../src/domains/netlist/netlist_graph_projection.js";
import { applyLayoutGoldenState } from "../../src/app/layoutGoldenImport.js";
import { getLayoutGoldenState } from "../../src/domains/netlist/layout_golden.js";

const SINGLE_STATE_FIELDS = [...SINGLE_NAVIGATION_FIELDS,
  "transform", "layoutPolicy", "presentationPolicy", "nodePositions", "nodeSizes", "graphOverrides"];
const COMPARE_STATE_FIELDS = [...COMPARE_NAVIGATION_FIELDS,
  "transforms", "nodePositions", "nodeSizes", "graphOverrides"];
const DEFAULT_VIEWPORT = { x: 0, y: 0, scale: 1 };

function createBridges(state) {
  const sessions = createViewSessionStore();
  const options = { state, sessions, getDocumentId: () => state.document?.documentId || null };
  return {
    sessions,
    single: createSingleViewSessionBridge(options),
    compare: createCompareViewSessionBridge(options)
  };
}

function setup() {
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  state.document = { documentId: "state-migration" };
  state.design = parseVerilog("module top(input a, output y); BUF u0 (.A(a), .Y(y)); endmodule module peer(input a, output y); INV u1 (.A(a), .Y(y)); endmodule");
  state.currentModule = state.design.modules[0];
  state.fullGraph = state.graph = buildWorkspaceGraph(state.currentModule);
  state.compare.leftModuleName = "top";
  state.compare.rightModuleName = "peer";
  state.compare.fullGraphs = { left: state.fullGraph, right: buildWorkspaceGraph(state.design.modules[1]) };
  return { state, ...createBridges(state), node: state.fullGraph.nodes.find((node) => node.kind === "cell") };
}

function policy(cellSpacing) {
  return normalizeLayoutPolicy({ ...DEFAULT_LAYOUT_POLICY, spacing: { ...DEFAULT_LAYOUT_POLICY.spacing, cellSpacing } });
}

function overrides(nodeId, x = 42) {
  return {
    nodePositions: new Map([[nodeId, { x, y: 84 }]]),
    nodeSizes: new Map([[nodeId, { width: 120, height: 80 }]]),
    graphOverrides: { nodeProperties: { [nodeId]: { label: "custom label" } }, cellPinDirections: {}, unroutedNets: ["a"] }
  };
}

function readonlyPort(state) {
  return createLegacyPort(() => state, Object.keys(state), {
    writable: true, readOnly: SINGLE_STATE_FIELDS,
    nestedFields: { compare: Object.keys(state.compare) },
    nestedReadOnly: { compare: COMPARE_STATE_FIELDS }
  });
}

test("Single commands and computation ignore stale viewport, policies and override projections", () => {
  const { state, single, node } = setup();
  single.importState({ viewport: { x: 10, y: 20, scale: 1.5 }, layoutPolicy: policy(12),
    presentationPolicy: { gateSymbolMode: "conventional" }, overrides: overrides(node.id) });
  const expected = single.readState();
  const corruptProjection = () => Object.assign(state, {
    transform: { x: -200, y: -300, scale: 4 }, layoutPolicy: policy(30),
    presentationPolicy: { gateSymbolMode: "rectangle" },
    nodePositions: new Map(), nodeSizes: new Map(), graphOverrides: { nodeProperties: {}, cellPinDirections: {} }
  });
  corruptProjection();
  const selected = single.dispatch({ type: "selection.set", objectRef: single.objectRefForNode(node) }).session;
  assert.deepEqual(selected.viewport, expected.viewport);
  assert.deepEqual(selected.layoutPolicy, expected.layoutPolicy);
  assert.deepEqual(selected.presentationPolicy, expected.presentationPolicy);
  assert.equal(selected.overrides, expected.overrides);
  assert.equal(selected.computationRevision, expected.computationRevision);
  corruptProjection();
  const computing = single.beginComputation();
  assert.deepEqual(computing.viewport, expected.viewport);
  assert.deepEqual(computing.layoutPolicy, expected.layoutPolicy);
  assert.deepEqual(computing.presentationPolicy, expected.presentationPolicy);
  assert.equal(computing.overrides, expected.overrides);
  assert.deepEqual(state.transform, expected.viewport);
  assert.deepEqual(state.nodePositions, expected.overrides.nodePositions);
});

test("Compare commands and computation never re-import mutated side projections", () => {
  const { state, sessions, single, compare, node } = setup();
  single.importState({ layoutPolicy: policy(14), presentationPolicy: { gateSymbolMode: "conventional" } });
  compare.importState("left", { viewport: { x: 5, y: 6, scale: 2 }, overrides: overrides(node.id) });
  compare.importState("right", { viewport: { x: 7, y: 8, scale: 0.75 }, overrides: overrides("cell:u1", 90) });
  const left = sessions.require("compare:left");
  const right = sessions.require("compare:right");
  const corruptProjection = () => {
    state.layoutPolicy = policy(36);
    state.presentationPolicy = { gateSymbolMode: "rectangle" };
    state.compare.transforms = { left: { x: 999, y: 999, scale: 9 }, right: { ...DEFAULT_VIEWPORT } };
    state.compare.nodePositions = { left: new Map(), right: new Map() };
    state.compare.nodeSizes = { left: new Map(), right: new Map() };
    state.compare.graphOverrides = { left: {}, right: {} };
  };
  corruptProjection();
  const selected = compare.dispatch("left", { type: "selection.set", objectRef: compare.objectRef("left", "cell", "u0") }).session;
  assert.deepEqual(selected.viewport, left.viewport);
  assert.deepEqual(selected.layoutPolicy, left.layoutPolicy);
  assert.deepEqual(selected.presentationPolicy, left.presentationPolicy);
  assert.equal(selected.overrides, left.overrides);
  assert.equal(selected.computationRevision, left.computationRevision);
  corruptProjection();
  const computing = compare.beginComputation("right");
  assert.deepEqual(computing.viewport, right.viewport);
  assert.deepEqual(computing.layoutPolicy, right.layoutPolicy);
  assert.equal(computing.overrides, right.overrides);
  assert.deepEqual(state.compare.nodePositions.right, right.overrides.nodePositions);
});

test("viewport updates reuse immutable overrides and policies without invalidating computation", () => {
  const { state, sessions, single, compare, node } = setup();
  single.importState({ overrides: overrides(node.id), layoutPolicy: policy(16) });
  compare.importState("left", { overrides: overrides(node.id, 50) });
  const beforeSingle = single.readState();
  const beforeCompare = sessions.require("compare:left");
  for (let index = 1; index <= 8; index++) {
    single.dispatch({ type: "viewport.set", viewport: { x: index, y: index * 2, scale: 1.25 } });
    compare.dispatch("left", { type: "viewport.set", viewport: { x: -index, y: index, scale: 0.8 } });
  }
  const afterSingle = single.readState();
  const afterCompare = sessions.require("compare:left");
  for (const [before, after] of [[beforeSingle, afterSingle], [beforeCompare, afterCompare]]) {
    assert.equal(after.overrides, before.overrides, "a viewport preview must not copy the override collection");
    assert.equal(after.layoutPolicy, before.layoutPolicy);
    assert.equal(after.presentationPolicy, before.presentationPolicy);
    assert.equal(after.computationRevision, before.computationRevision);
  }
  assert.equal(state.nodePositions, afterSingle.overrides.nodePositions);
  assert.equal(state.compare.nodePositions.left, afterCompare.overrides.nodePositions);
});

test("remaining controller state projections reject assignments and nested collection mutations", () => {
  const { state, single, compare, node } = setup();
  single.importState({ overrides: overrides(node.id) });
  compare.importState("left", { overrides: overrides(node.id, 99) });
  const port = readonlyPort(state);
  for (const key of ["transform", "layoutPolicy", "presentationPolicy", "nodePositions", "nodeSizes", "graphOverrides"]) {
    assert.throws(() => { port[key] = {}; }, TypeError, key);
    assert.throws(() => Object.defineProperty(port, key, { value: {} }), TypeError, key);
  }
  assert.throws(() => { port.transform.x = 900; }, TypeError);
  assert.throws(() => { port.layoutPolicy.spacing.cellSpacing = 900; }, TypeError);
  assert.throws(() => { port.presentationPolicy.gateSymbolMode = "conventional"; }, TypeError);
  assert.throws(() => port.nodePositions.set("bad", { x: 1, y: 1 }), TypeError);
  assert.throws(() => port.nodeSizes.clear(), TypeError);
  assert.throws(() => { port.nodePositions.get(node.id).x = 900; }, TypeError);
  assert.throws(() => port.graphOverrides.unroutedNets.push("bad"), TypeError);
  assert.throws(() => { port.compare.transforms = {}; }, /mutation/);
  assert.throws(() => { port.compare.transforms.left = {}; }, TypeError);
  assert.throws(() => { port.compare.transforms.left.x = 900; }, TypeError);
  assert.throws(() => { port.compare.nodePositions.left = new Map(); }, TypeError);
  assert.throws(() => port.compare.nodePositions.left.clear(), TypeError);
  assert.throws(() => Map.prototype.set.call(port.compare.nodePositions.left, "bad", {}), TypeError);
  assert.throws(() => { port.compare.graphOverrides.left.nodeProperties[node.id].label = "bad"; }, TypeError);
  assert.equal(state.nodePositions.get(node.id).x, 42);
  assert.equal(state.compare.nodePositions.left.get(node.id).x, 99);
});

test("startup state is authoritative before opening a document and reset clears geometry but keeps policies", () => {
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  const { single, sessions } = createBridges(state);
  const layoutPolicy = policy(18);
  single.importState({ transform: { x: 12, y: 24, scale: 1.2 }, layoutPolicy,
    presentationPolicy: { gateSymbolMode: "conventional" }, overrides: overrides("cell:startup") });
  assert.equal(sessions.list().length, 0, "startup settings do not manufacture a document session");
  state.transform = { x: 999, y: 999, scale: 9 };
  state.layoutPolicy = policy(99);
  state.nodePositions = new Map();
  assert.deepEqual(single.readState().viewport, { x: 12, y: 24, scale: 1.2 });
  state.document = { documentId: "opened" };
  state.currentModule = { name: "top" };
  const opened = single.beginComputation();
  assert.deepEqual(opened.layoutPolicy, layoutPolicy);
  assert.equal(opened.overrides.nodePositions.get("cell:startup").x, 42);
  single.resetNavigation();
  state.currentModule = { name: "next" };
  const reset = single.beginComputation();
  assert.deepEqual(reset.viewport, DEFAULT_VIEWPORT);
  assert.equal(reset.overrides?.nodePositions?.size || 0, 0);
  assert.equal(reset.overrides?.nodeSizes?.size || 0, 0);
  assert.deepEqual(reset.layoutPolicy, layoutPolicy);
  assert.deepEqual(reset.presentationPolicy, { gateSymbolMode: "conventional" });
});

test("canonical policy changes reach existing Compare sessions and later side creation", () => {
  const { state, sessions, single, compare } = setup();
  single.importState({ layoutPolicy: policy(10) });
  compare.ensure("left");
  compare.ensure("right");
  const beforeLeft = sessions.require("compare:left");
  const layoutPolicy = policy(20);
  single.dispatch({ type: "layout.policy.set", layoutPolicy });
  assert.deepEqual(sessions.require("compare:left").layoutPolicy, layoutPolicy);
  assert.deepEqual(sessions.require("compare:right").layoutPolicy, layoutPolicy);
  assert.ok(sessions.require("compare:left").computationRevision > beforeLeft.computationRevision);
  const afterLayout = sessions.require("compare:left").computationRevision;
  single.dispatch({ type: "presentation.policy.set", presentationPolicy: { gateSymbolMode: "conventional" } });
  assert.equal(sessions.require("compare:left").computationRevision, afterLayout);
  assert.deepEqual(sessions.require("compare:right").presentationPolicy, { gateSymbolMode: "conventional" });
  sessions.close("compare:right");
  state.layoutPolicy = policy(80);
  state.presentationPolicy = { gateSymbolMode: "rectangle" };
  const recreated = compare.ensure("right");
  assert.deepEqual(recreated.layoutPolicy, single.readState().layoutPolicy);
  assert.deepEqual(recreated.presentationPolicy, single.readState().presentationPolicy);
});

test("policy propagation and peer viewport updates keep the active Compare selection", () => {
  const { state, sessions, single, compare } = setup();
  single.importState({ layoutPolicy: policy(12) });
  compare.dispatch("right", { type: "selection.set", objectRef: compare.objectRef("right", "cell", "u1") });
  compare.dispatch("left", { type: "selection.set", objectRef: compare.objectRef("left", "cell", "u0") });
  const rightSelection = sessions.require("compare:right").selectedObjectRef;
  single.dispatch({ type: "layout.policy.set", layoutPolicy: policy(22) });
  single.dispatch({ type: "presentation.policy.set", presentationPolicy: { gateSymbolMode: "conventional" } });
  compare.dispatch("right", { type: "viewport.set", viewport: { x: 50, y: 60, scale: 0.5 } });
  assert.equal(state.compare.selectedSide, "left");
  assert.equal(state.compare.selectedName, "u0");
  assert.deepEqual(sessions.require("compare:right").selectedObjectRef, rightSelection);
  assert.deepEqual(state.layoutPolicy, single.readState().layoutPolicy);
  assert.deepEqual(state.presentationPolicy, single.readState().presentationPolicy);
});

test("module restore imports overrides through readonly projections without restoring a saved viewport", () => {
  const { state, single, node } = setup();
  single.importNavigation({ focusedRootNodeIds: [node.id], viewMode: "focused", overrides: overrides(node.id),
    transform: { x: 10, y: 20, scale: 1.5 } });
  saveModuleWorkspace(state, "top");
  single.importState({ overrides: overrides(node.id, 500), viewport: { x: 90, y: 80, scale: 2 } });
  assert.equal(restoreModuleWorkspace(readonlyPort(state), "top", single.importNavigation), true);
  assert.equal(single.readState().overrides.nodePositions.get(node.id).x, 42);
  assert.deepEqual(state.focusedRootNodeIds, [node.id]);
  assert.deepEqual(single.readState().viewport, { x: 90, y: 80, scale: 2 }, "module archives retain their existing override/query scope");
});

test("Compare workspace restore imports separate viewports and overrides through readonly projections", () => {
  const { state, sessions, single, compare, node } = setup();
  single.importState({ layoutPolicy: policy(12) });
  compare.importState("left", { viewport: { x: 5, y: 6, scale: 0.7 }, overrides: overrides(node.id) });
  compare.importState("right", { viewport: { x: 7, y: 8, scale: 1.7 }, overrides: overrides("cell:u1", 70) });
  compare.replaceRoots("left", [node.id]);
  saveCompareWorkspace(state);
  compare.importState("left", { viewport: DEFAULT_VIEWPORT, overrides: overrides(node.id, 800) });
  compare.importState("right", { viewport: DEFAULT_VIEWPORT, overrides: overrides("cell:u1", 900) });
  assert.equal(restoreCompareWorkspace(readonlyPort(state), "top", "peer", compare.importNavigation), true);
  assert.deepEqual(sessions.require("compare:left").viewport, { x: 5, y: 6, scale: 0.7 });
  assert.deepEqual(sessions.require("compare:right").viewport, { x: 7, y: 8, scale: 1.7 });
  assert.equal(sessions.require("compare:left").overrides.nodePositions.get(node.id).x, 42);
  assert.equal(sessions.require("compare:right").overrides.nodePositions.get("cell:u1").x, 70);
  assert.deepEqual(state.compare.focusedRootNodeIds.left, [node.id]);
});

test("Compare reset retires startup geometry before a side session is recreated", () => {
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  state.document = { documentId: "compare-reset" };
  state.currentModule = { name: "top" };
  state.compare.leftModuleName = "top";
  state.compare.rightModuleName = "peer";
  state.compare.transforms.left = { x: 40, y: 50, scale: 2 };
  state.compare.nodePositions.left = new Map([["cell:old", { x: 100, y: 200 }]]);
  const { single, compare } = createBridges(state);
  single.importState({ layoutPolicy: policy(26), presentationPolicy: { gateSymbolMode: "conventional" } });
  assert.equal(compare.ensure("left").overrides.nodePositions.get("cell:old").x, 100);
  compare.resetState();
  const recreated = compare.ensure("left");
  assert.deepEqual(recreated.viewport, DEFAULT_VIEWPORT);
  assert.equal(recreated.overrides.nodePositions.size, 0);
  assert.equal(recreated.overrides.nodeSizes.size, 0);
  assert.deepEqual(recreated.layoutPolicy, single.readState().layoutPolicy);
  assert.deepEqual(recreated.presentationPolicy, single.readState().presentationPolicy);
  assert.equal(state.compare.nodePositions.left.size, 0);
});

test("Golden import applies layout policy and geometry through the explicit state boundary", () => {
  const { state, single, node } = setup();
  single.importState({ layoutPolicy: policy(12), overrides: overrides(node.id, 300) });
  const golden = getLayoutGoldenState(JSON.stringify({ kind: "netlist-layout-golden", version: 2, moduleName: "top",
    nodes: [{ id: node.id, x: 11, y: 22, width: 120, height: 80 }],
    layoutOptions: { layoutPolicy: policy(24), display: { viewMode: "whole", faninDepth: 0, fanoutDepth: 2 } } }));
  applyLayoutGoldenState(readonlyPort(state), golden, single.importNavigation);
  assert.deepEqual([...single.readState().overrides.nodePositions], [...golden.nodePositions]);
  assert.deepEqual([...single.readState().overrides.nodeSizes], [...golden.nodeSizes]);
  assert.deepEqual(single.readState().layoutPolicy, golden.layoutPolicy);
  assert.equal(single.readQuery().faninDepth, 0);
  assert.equal(single.readQuery().fanoutDepth, 2);
});

test("explicit state imports detach caller-owned Maps, positions and policy records", () => {
  const { single, compare, sessions, node } = setup();
  const source = overrides(node.id);
  const layoutPolicy = structuredClone(policy(28));
  const viewport = { x: 2, y: 4, scale: 2 };
  single.importState({ overrides: source, layoutPolicy, viewport });
  compare.importState("left", { ...source, viewport });
  source.nodePositions.get(node.id).x = 999;
  source.nodePositions.clear();
  source.graphOverrides.unroutedNets.push("y");
  layoutPolicy.spacing.cellSpacing = 999;
  viewport.x = 999;
  for (const session of [single.readState(), sessions.require("compare:left")]) {
    assert.equal(session.overrides.nodePositions.get(node.id).x, 42);
    assert.deepEqual(session.overrides.graphOverrides.unroutedNets, ["a"]);
    assert.deepEqual(session.viewport, { x: 2, y: 4, scale: 2 });
    assert.equal(session.layoutPolicy.spacing.cellSpacing, 28);
  }
});

test("override commands normalize archive arrays and missing fields before exposing readonly projections", () => {
  const { state, single, compare, node } = setup();
  single.importState({ layoutPolicy: policy(12) });
  const position = { x: 31, y: 62 };
  single.dispatch({ type: "overrides.set", overrides: { nodePositions: [[node.id, position]] } });
  compare.dispatch("left", { type: "overrides.set", overrides: { nodePositions: [[node.id, position]] } });
  position.x = 999;
  for (const target of [
    { positions: state.nodePositions, sizes: state.nodeSizes, graph: state.graphOverrides },
    { positions: state.compare.nodePositions.left, sizes: state.compare.nodeSizes.left, graph: state.compare.graphOverrides.left }
  ]) {
    assert.equal(target.positions instanceof Map, true);
    assert.deepEqual(target.positions.get(node.id), { x: 31, y: 62 });
    assert.equal(target.sizes instanceof Map, true);
    assert.equal(target.sizes.size, 0);
    assert.deepEqual(target.graph, { nodeProperties: {}, cellPinDirections: {} });
    assert.throws(() => target.positions.clear(), TypeError);
  }
  single.dispatch({ type: "overrides.set", overrides: null });
  compare.dispatch("left", { type: "overrides.set", overrides: null });
  assert.equal(state.nodePositions.size, 0);
  assert.equal(state.compare.nodePositions.left.size, 0);
});

test("resolving delayed navigation does not replay older geometry or policies", () => {
  const { state, single, node } = setup();
  const graph = state.fullGraph;
  state.fullGraph = null;
  single.importNavigation({ focusedRootNodeIds: [node.id], viewMode: "focused",
    overrides: overrides(node.id), layoutPolicy: policy(12), viewport: { x: 1, y: 2, scale: 1 } });
  single.importState({ overrides: overrides(node.id, 100), layoutPolicy: policy(30),
    presentationPolicy: { gateSymbolMode: "conventional" }, viewport: { x: 3, y: 4, scale: 2 } });
  const latest = single.readState();
  state.fullGraph = graph;
  const resolved = single.refreshNavigation();
  assert.equal(resolved.focusedRootRefs[0].localId, "u0");
  assert.equal(resolved.computationRevision, latest.computationRevision);
  assert.equal(resolved.overrides, latest.overrides);
  assert.deepEqual(resolved.layoutPolicy, latest.layoutPolicy);
  assert.deepEqual(resolved.presentationPolicy, latest.presentationPolicy);
  assert.deepEqual(resolved.viewport, latest.viewport);
});
