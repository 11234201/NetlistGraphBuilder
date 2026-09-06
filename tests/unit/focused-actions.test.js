import test from "node:test";
import assert from "node:assert/strict";
import { resolveFocusedRootAction } from "../../src/app/focusedSelection.js";

test("consecutive adds preserve roots, removal preserves a valid active root", () => {
  let state = { rootNodeIds: [] };
  for (const nodeId of ["A", "B", "C"]) {
    state = resolveFocusedRootAction(state, { type: "add", nodeId });
  }
  assert.deepEqual(state.rootNodeIds, ["A", "B", "C"]);
  assert.equal(state.activeRootNodeId, "C");
  const duplicate = resolveFocusedRootAction(state, { type: "add", nodeId: "C" });
  assert.equal(duplicate.changed, false);
  state = resolveFocusedRootAction(state, { type: "remove", nodeId: "C" });
  assert.equal(state.activeRootNodeId, "A");
  state = resolveFocusedRootAction(state, { type: "activate", nodeId: "B" });
  assert.equal(state.changed, false);
  assert.equal(state.activeRootNodeId, "B");
  state = resolveFocusedRootAction(state, { type: "set", nodeId: "D" });
  assert.deepEqual(state.rootNodeIds, ["D"]);
  state = resolveFocusedRootAction(state, { type: "clear" });
  assert.deepEqual(state.rootNodeIds, []);
  assert.equal(state.activeRootNodeId, null);
});

test("capacity rejection never silently replaces a lexically later root", () => {
  const original = { rootNodeIds: ["B", "C"], activeRootNodeId: "C" };
  const result = resolveFocusedRootAction(original, { type: "add", nodeId: "A" }, { maximumRoots: 2 });
  assert.deepEqual(result.rootNodeIds, ["B", "C"]);
  assert.equal(result.rejected, true);
  assert.equal(result.activeRootNodeId, "C");
  assert.deepEqual(original.rootNodeIds, ["B", "C"]);
});
