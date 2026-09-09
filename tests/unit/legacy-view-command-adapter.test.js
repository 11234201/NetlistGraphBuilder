import assert from "node:assert/strict";
import test from "node:test";
import { createLegacyViewCommandAdapter } from "../../src/app/legacy_view_command_adapter.js";

function setup() {
  const nodes = ["u1", "u2", "u3"].map((instance) => ({ id: `cell:${instance}`, kind: "cell", ref: { instance } }));
  const state = {
    currentModule: { name: "top" },
    fullGraph: { nodes },
    graph: { nodes: nodes.slice(0, 1) },
    viewMode: "focused",
    focusedRootNodeIds: ["cell:u1"],
    activeFocusedRootNodeId: "cell:u1",
    coneRootNodeId: "cell:u1"
  };
  return { state, adapter: createLegacyViewCommandAdapter({ state, getDocumentId: () => "doc:1" }) };
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
