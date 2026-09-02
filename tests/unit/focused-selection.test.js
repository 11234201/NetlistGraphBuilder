import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeFocusedRootNodeIds,
  resolveFocusedRootTarget
} from "../../src/app/focusedSelection.js";

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
  assert.equal(resolveFocusedRootTarget(
    graph,
    "cell:u0",
    ["cell:u0", "cell:u1"],
    "focused"
  ), "cell:u0");
  assert.equal(resolveFocusedRootTarget(graph, "input:a", "cell:u0", "focused"), null);
  assert.equal(resolveFocusedRootTarget(graph, "cell:missing", "cell:u0", "focused"), null);
});

test("Focused root normalization applies a named maximum deterministically", () => {
  const roots = Array.from({ length: 5 }, (_, index) => `cell:u${index}`);
  assert.deepEqual(
    normalizeFocusedRootNodeIds([...roots, "cell:u1"], { maximumRoots: 3 }),
    ["cell:u0", "cell:u1", "cell:u2"]
  );
});
