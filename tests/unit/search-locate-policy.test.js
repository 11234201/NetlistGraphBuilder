import assert from "node:assert/strict";
import test from "node:test";
import {
  isSearchTargetPositioned,
  resolveSearchTargetAction,
  shouldRevealSearchTarget
} from "../../src/app/searchLocatePolicy.js";

const graph = {
  nodes: [
    { id: "cell:u1", kind: "cell", ref: { instance: "u1" } },
    { id: "port:out", kind: "output", ref: { name: "out" } }
  ],
  edges: [{ id: "edge:n1", net: "n1" }]
};

test("search positioning checks the canvas graph rather than the full graph", () => {
  assert.equal(isSearchTargetPositioned({ kind: "cell", name: "u1" }, graph), true);
  assert.equal(isSearchTargetPositioned({ kind: "net", name: "n1" }, graph), true);
  assert.equal(isSearchTargetPositioned({ kind: "port", name: "out", direction: "output" }, graph), true);
  assert.equal(isSearchTargetPositioned({ kind: "cell", name: "u2" }, graph), false);
});

test("search positioning recognizes projected local ids on the canvas", () => {
  const projected = {
    nodes: [
      { id: "cell:leaf", kind: "cell", ref: { localId: "leaf", occurrencePath: ["u_right"] } },
      { id: "hub:out", kind: "hub", ref: { localId: "out" } }
    ],
    edges: []
  };
  assert.equal(isSearchTargetPositioned({ kind: "cell", name: "leaf" }, projected), true);
  assert.equal(isSearchTargetPositioned({ kind: "net", name: "out" }, projected), true);
});

test("only a focus-capable target outside the canvas is revealed", () => {
  const fullGraph = { ...graph, nodes: [...graph.nodes, { id: "cell:u2", kind: "cell", ref: { instance: "u2" } }] };
  assert.equal(shouldRevealSearchTarget({ kind: "cell", name: "u2" }, graph, fullGraph), true);
  assert.equal(shouldRevealSearchTarget({ kind: "net", name: "n2" }, graph, { ...fullGraph, edges: [{ net: "n2" }] }), true);
  assert.equal(shouldRevealSearchTarget({ kind: "port", name: "in", direction: "input" }, graph, fullGraph), false);
  assert.equal(shouldRevealSearchTarget({ kind: "cell", name: "u1" }, graph, fullGraph), false);
});

test("search action locates positioned targets and focuses only full-graph misses", () => {
  const fullGraph = { ...graph, nodes: [...graph.nodes, { id: "cell:u2", kind: "cell", ref: { instance: "u2" } }] };
  assert.equal(resolveSearchTargetAction({ kind: "cell", name: "u1" }, graph, fullGraph), "locate");
  assert.equal(resolveSearchTargetAction({ kind: "cell", name: "u2" }, graph, fullGraph), "focus");
  assert.equal(resolveSearchTargetAction({ kind: "cell", name: "missing" }, graph, fullGraph), "unavailable");
  assert.equal(resolveSearchTargetAction({ kind: "port", name: "in", direction: "input" }, graph, fullGraph), "unavailable");
});
