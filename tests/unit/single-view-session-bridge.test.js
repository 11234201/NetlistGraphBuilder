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

test("legacy adapter routes hidden search selection through selection.reveal", () => {
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

test("legacy adapter keeps visible selection layout-free and supports explicit replacement", () => {
  const { state, adapter } = setup();
  const u1 = adapter.objectRefForNode(state.fullGraph.nodes[0]);
  const visible = adapter.dispatch({ type: "selection.reveal", objectRef: u1, visibleObjectKeys: adapter.visibleObjectKeys() });
  assert.equal(visible.effects.layout, false);
  const replaced = adapter.dispatch({ type: "focus.set", objectRef: adapter.objectRefForNode(state.fullGraph.nodes[2]) });
  assert.equal(replaced.effects.layout, true);
  assert.deepEqual(state.focusedRootNodeIds, ["cell:u3"]);
});

test("legacy adapter keeps one ViewSession until document or unit identity changes", () => {
  const { state, adapter } = setup();
  adapter.dispatch({ type: "focus.set", objectRef: adapter.objectRefForNode(state.fullGraph.nodes[0]) });
  const first = adapter.sessions.require("legacy:single");
  adapter.dispatch({ type: "focus.add", objectRef: adapter.objectRefForNode(state.fullGraph.nodes[1]) });
  const second = adapter.sessions.require("legacy:single");
  assert.equal(second.sessionId, first.sessionId);
  assert.ok(second.sessionRevision > first.sessionRevision);
  state.currentModule = { name: "replacement" };
  state.fullGraph = { nodes: [{ id: "cell:x", kind: "cell", ref: { instance: "x" } }] };
  state.graph = state.fullGraph;
  state.focusedRootNodeIds = [];
  state.activeFocusedRootNodeId = null;
  adapter.dispatch({ type: "focus.set", objectRef: adapter.objectRefForNode(state.fullGraph.nodes[0]) });
  assert.equal(adapter.sessions.require("legacy:single").unitId, "replacement");
});

test("legacy adapter projects selection commands back to compatibility fields", () => {
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

test("legacy adapter projects viewport without invalidating computation", () => {
  const { state, adapter } = setup();
  state.transform = { x: 0, y: 0, scale: 1 };
  adapter.dispatch({ type: "selection.clear" });
  const before = adapter.sessions.require("legacy:single").computationRevision;
  const result = adapter.dispatch({ type: "viewport.set", viewport: { x: 12, y: 8, scale: 1.25 } });
  assert.deepEqual(state.transform, { x: 12, y: 8, scale: 1.25 });
  assert.equal(result.session.computationRevision, before);
});

test("legacy adapter projects layout policy and invalidates computation", () => {
  const { state, adapter } = setup();
  adapter.dispatch({ type: "selection.clear" });
  const before = adapter.sessions.require("legacy:single").computationRevision;
  const result = adapter.dispatch({ type: "layout.policy.set", layoutPolicy: { name: "custom", spacing: { cellSpacing: 80 } } });
  assert.equal(state.layoutPolicy.name, "custom");
  assert.equal(result.session.computationRevision, before + 1);
});

test("legacy adapter owns immutable-style override replacement", () => {
  const { state, adapter } = setup();
  adapter.dispatch({ type: "overrides.set", overrides: {
    nodePositions: new Map([["cell:u1", { x: 24, y: 32 }]]),
    nodeSizes: new Map(),
    graphOverrides: { nodeProperties: { "cell:u1": { label: "A" } }, cellPinDirections: {} }
  } });
  assert.deepEqual(state.nodePositions.get("cell:u1"), { x: 24, y: 32 });
  assert.equal(state.graphOverrides.nodeProperties["cell:u1"].label, "A");
});
