import assert from "node:assert/strict";
import test from "node:test";
import { resolveFocusedRootTarget } from "../../src/app/focusedSelection.js";

const graph = {
  nodes: [
    { id: "cell:u0", kind: "cell" },
    { id: "cell:u1", kind: "cell" },
    { id: "input:a", kind: "input" }
  ]
};

test("selected cells can replace the current Focused root", () => {
  assert.equal(resolveFocusedRootTarget(graph, "cell:u1", "cell:u0", "focused"), "cell:u1");
  assert.equal(resolveFocusedRootTarget(graph, "cell:u1", null, "whole"), "cell:u1");
  assert.equal(resolveFocusedRootTarget(graph, "cell:u0", "cell:u0", "focused"), null);
  assert.equal(resolveFocusedRootTarget(graph, "input:a", "cell:u0", "focused"), null);
  assert.equal(resolveFocusedRootTarget(graph, "cell:missing", "cell:u0", "focused"), null);
});
