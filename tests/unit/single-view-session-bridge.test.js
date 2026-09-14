import assert from "node:assert/strict";
import test from "node:test";
import { createSingleViewSessionBridge } from "../../src/app/single_view_session_bridge.js";

function setup() {
  const nodes = ["u1", "u2", "u3"].map((instance) => ({ id: `cell:${instance}`, kind: "cell", ref: { instance } }));
  const state = {
    currentModule: { name: "top" },
    fullGraph: { nodes },
    graph: { nodes: nodes.slice(0, 1) },
    viewMode: "focused",
    focusedRootNodeIds: ["cell:u1"],
    activeFocusedRootNodeId: "cell:u1",
    coneRootNodeId: "cell:u1",
    transform: { x: 0, y: 0, scale: 1 },
    layoutPolicy: { name: "default", spacing: { cellSpacing: 40 } },
    nodePositions: new Map(), nodeSizes: new Map(),
    graphOverrides: { nodeProperties: {}, cellPinDirections: {} }
  };
  return { state, adapter: createSingleViewSessionBridge({ state, getDocumentId: () => "doc:1" }) };
}

test("single view session bridge routes hidden search selection through selection.reveal", () => {
  const { state, adapter } = setup();
  const result = adapter.dispatch({
    type: "selection.reveal",
    objectRef: adapter.objectRefForNode(state.fullGraph.nodes[1]),
    visibleObjectKeys: adapter.visibleObjectKeys()
  });
  assert.equal(result.effects.layout, true);
  assert.deepEqual(state.focusedRootNodeIds, ["cell:u1", "cell:u2"]);
  assert.equal(state.activeFocusedRootNodeId, "cell:u2");
});

test("single view session bridge keeps visible selection layout-free and supports explicit replacement", () => {
  const { state, adapter } = setup();
  const u1 = adapter.objectRefForNode(state.fullGraph.nodes[0]);
  const visible = adapter.dispatch({ type: "selection.reveal", objectRef: u1, visibleObjectKeys: adapter.visibleObjectKeys() });
  assert.equal(visible.effects.layout, false);
  const replaced = adapter.dispatch({ type: "focus.set", objectRef: adapter.objectRefForNode(state.fullGraph.nodes[2]) });
  assert.equal(replaced.effects.layout, true);
  assert.deepEqual(state.focusedRootNodeIds, ["cell:u3"]);
});

test("single view session bridge follows a hidden connection without leaving Focused", () => {
  const { state, adapter } = setup();
  adapter.dispatch({ type: "focus.add", objectRef: adapter.objectRefForNode(state.fullGraph.nodes[1]) });
  const result = adapter.dispatch({
    type: "selection.reveal",
    objectRef: adapter.objectRefForNode(state.fullGraph.nodes[2]),
    visibleObjectKeys: adapter.visibleObjectKeys(),
    replaceActiveWhenFull: true
  });

  assert.equal(result.rejected, null);
  assert.equal(state.viewMode, "focused");
  assert.deepEqual(state.focusedRootNodeIds, ["cell:u1", "cell:u2", "cell:u3"]);
  assert.equal(state.activeFocusedRootNodeId, "cell:u3");
  assert.equal(result.effects.layout, true);
});

test("single view session bridge preserves net roots as canonical net ObjectRefs", () => {
  const { state, adapter } = setup();
  state.fullGraph.edges = [{ id: "e1", source: "cell:u1", target: "cell:u2", net: "n1" }];
  state.graph.edges = state.fullGraph.edges;
  const result = adapter.dispatch({ type: "focus.set", objectRef: adapter.objectRefForNet("n1") });

  assert.equal(result.session.focusedRootRefs[0].kind, "net");
  assert.equal(result.session.focusedRootRefs[0].localId, "n1");
  assert.deepEqual(state.focusedRootNodeIds, ["net:n1"]);
  assert.equal(state.activeFocusedRootNodeId, "net:n1");
});

test("single view session bridge preserves occurrence identity for repeated projected roots", () => {
  const nodes = [
    { id: "cell:u_left", kind: "cell", ref: { kind: "cell", localId: "leaf", occurrencePath: ["u_left"] } },
    { id: "cell:u_right", kind: "cell", ref: { kind: "cell", localId: "leaf", occurrencePath: ["u_right"] } }
  ];
  const state = {
    currentModule: { name: "leaf" },
    occurrenceContext: { rootModuleName: "top", occurrencePath: ["u_right"] },
    fullGraph: { nodes },
    graph: { nodes },
    viewMode: "focused", focusedRootNodeIds: ["cell:u_right"], activeFocusedRootNodeId: "cell:u_right",
    coneRootNodeId: "cell:u_right", transform: { x: 0, y: 0, scale: 1 },
    layoutPolicy: { name: "default" }, nodePositions: new Map(), nodeSizes: new Map(),
    graphOverrides: { nodeProperties: {}, cellPinDirections: {} }
  };
  const adapter = createSingleViewSessionBridge({ state, getDocumentId: () => "doc:1" });
  adapter.beginComputation();
  const session = adapter.sessions.require("single:primary");
  assert.deepEqual(session.focusedRootRefs[0].occurrencePath, ["u_right"]);
  assert.equal(session.focusedRootRefs[0].localId, "leaf");

  const result = adapter.dispatch({ type: "focus.activate", objectRef: session.focusedRootRefs[0] });
  assert.equal(result.session.activeFocusedRootRef.localId, "leaf");
  assert.deepEqual(result.session.activeFocusedRootRef.occurrencePath, ["u_right"]);
  assert.equal(state.activeFocusedRootNodeId, "cell:u_right");
});

test("single view session bridge keeps one ViewSession until document or unit identity changes", () => {
  const { state, adapter } = setup();
  adapter.dispatch({ type: "focus.set", objectRef: adapter.objectRefForNode(state.fullGraph.nodes[0]) });
  const first = adapter.sessions.require("single:primary");
  adapter.dispatch({ type: "focus.add", objectRef: adapter.objectRefForNode(state.fullGraph.nodes[1]) });
  const second = adapter.sessions.require("single:primary");
  assert.equal(second.sessionId, first.sessionId);
  assert.equal(second.sessionRevision, first.sessionRevision + 1);
  state.currentModule = { name: "replacement" };
  state.fullGraph = { nodes: [{ id: "cell:x", kind: "cell", ref: { instance: "x" } }] };
  state.graph = state.fullGraph;
  state.focusedRootNodeIds = [];
  state.activeFocusedRootNodeId = null;
  adapter.dispatch({ type: "focus.set", objectRef: adapter.objectRefForNode(state.fullGraph.nodes[0]) });
  assert.equal(adapter.sessions.require("single:primary").unitId, "replacement");
});

test("single view session bridge projects selection commands back to compatibility fields", () => {
  const { state, adapter } = setup();
  adapter.dispatch({ type: "selection.set", objectRef: adapter.objectRefForNode(state.fullGraph.nodes[1]) });
  assert.equal(state.selectedNodeId, "cell:u2");
  assert.equal(state.selectedNet, null);
  adapter.dispatch({ type: "selection.set", objectRef: adapter.objectRefForNet("n1") });
  assert.equal(state.selectedNodeId, null);
  assert.equal(state.selectedNet, "n1");
  adapter.dispatch({ type: "selection.clear" });
  assert.equal(state.selectedNodeId, null);
  assert.equal(state.selectedNet, null);
});

test("single view session bridge projects viewport without invalidating computation", () => {
  const { state, adapter } = setup();
  state.transform = { x: 0, y: 0, scale: 1 };
  adapter.dispatch({ type: "selection.clear" });
  const before = adapter.sessions.require("single:primary").computationRevision;
  const result = adapter.dispatch({ type: "viewport.set", viewport: { x: 12, y: 8, scale: 1.25 } });
  assert.deepEqual(state.transform, { x: 12, y: 8, scale: 1.25 });
  assert.equal(result.session.computationRevision, before);
});

test("single view session bridge projects layout policy and invalidates computation", () => {
  const { state, adapter } = setup();
  adapter.dispatch({ type: "selection.clear" });
  const before = adapter.sessions.require("single:primary").computationRevision;
  const result = adapter.dispatch({ type: "layout.policy.set", layoutPolicy: { name: "custom", spacing: { cellSpacing: 80 } } });
  assert.equal(state.layoutPolicy.name, "custom");
  assert.equal(result.session.computationRevision, before + 1);
});

test("single view session bridge exposes an explicit computation boundary", () => {
  const { adapter } = setup();
  const before = adapter.beginComputation();
  const next = adapter.beginComputation();
  assert.equal(next.sessionId, before.sessionId);
  assert.equal(next.computationRevision, before.computationRevision + 1);
});

test("single view session bridge owns immutable-style override replacement", () => {
  const { state, adapter } = setup();
  adapter.dispatch({ type: "overrides.set", overrides: {
    nodePositions: new Map([["cell:u1", { x: 24, y: 32 }]]),
    nodeSizes: new Map(),
    graphOverrides: { nodeProperties: { "cell:u1": { label: "A" } }, cellPinDirections: {} }
  } });
  assert.deepEqual(state.nodePositions.get("cell:u1"), { x: 24, y: 32 });
  assert.equal(state.graphOverrides.nodeProperties["cell:u1"].label, "A");
});

test("single view session bridge projects unit navigation and clears scoped mirrors", () => {
  const { state, adapter } = setup();
  state.nodePositions.set("cell:u0", { x: 1, y: 2 });
  const result = adapter.dispatch({ type: "unit.set", unitId: "replacement", viewMode: "search-first" });
  assert.equal(result.session.unitId, "replacement");
  assert.equal(state.viewMode, "search-first");
  assert.deepEqual(state.focusedRootNodeIds, []);
  assert.equal(state.selectedNodeId, null);
  assert.equal(state.nodePositions.size, 0);
});
