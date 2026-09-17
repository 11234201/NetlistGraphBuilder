import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_MINIMAL_SPAN_POLICY,
  relaxToMinimalSpan,
  summarizeLayerSpans
} from "../../src/layout/layered/minSpanLayering.js";
import { DEFAULT_LAYOUT_POLICY, normalizeLayoutPolicy } from "../../src/layout/layoutPolicy.js";

test("a source feeding one deep target is pushed next to that target", () => {
  // Longest path pins `in` at 0 and leaves a four-layer edge. Minimal span
  // moves it directly left of `deep`, which then lets the `a-b-c` chain slide
  // back to the origin because nothing occupies layer 0 any more. Every edge
  // ends up spanning exactly one layer.
  const graph = makeGraph();
  const initial = new Map([
    ["in", 0],
    ["a", 1],
    ["b", 2],
    ["c", 3],
    ["deep", 4]
  ]);

  const levels = relaxToMinimalSpan(graph, initial, DEFAULT_MINIMAL_SPAN_POLICY);

  assert.equal(levels.get("deep") - levels.get("in"), 1);
  assert.deepEqual([levels.get("a"), levels.get("b"), levels.get("c")], [0, 1, 2]);
  assert.deepEqual(summarizeLayerSpans(graph, levels).spanHistogram, [[1, 4]]);
});

test("a sink with one shallow driver is pulled next to that driver", () => {
  const graph = {
    nodes: [
      { id: "a", label: "a", kind: "cell" },
      { id: "b", label: "b", kind: "cell" },
      { id: "out", label: "out", kind: "focus-output" }
    ],
    edges: [
      { id: "a-b", source: "a", target: "b" },
      { id: "b-out", source: "b", target: "out" }
    ]
  };
  // `out` starts two layers below its driver, which is feasible but not
  // minimal: pulling it to 2 shortens the last edge.
  const initial = new Map([["a", 0], ["b", 1], ["out", 4]]);

  const levels = relaxToMinimalSpan(graph, initial, DEFAULT_MINIMAL_SPAN_POLICY);

  assert.equal(levels.get("out"), 2);
  assert.equal(summarizeLayerSpans(graph, levels).totalEdgeSpan, 2);
});

test("primary ports stay anchored by default and move only when opted out", () => {
  const graph = {
    nodes: [
      { id: "in", label: "in", kind: "input" },
      { id: "a", label: "a", kind: "cell" },
      { id: "b", label: "b", kind: "cell" },
      { id: "c", label: "c", kind: "cell" }
    ],
    edges: [
      { id: "in-c", source: "in", target: "c" },
      { id: "a-b", source: "a", target: "b" },
      { id: "b-c", source: "b", target: "c" }
    ]
  };
  const initial = new Map([["in", 0], ["a", 0], ["b", 1], ["c", 2]]);

  const anchored = relaxToMinimalSpan(graph, initial, DEFAULT_MINIMAL_SPAN_POLICY);
  assert.equal(anchored.get("in"), 0);

  const freed = relaxToMinimalSpan(graph, initial, {
    ...DEFAULT_MINIMAL_SPAN_POLICY,
    anchorPrimaryPorts: false
  });
  assert.equal(freed.get("in"), 1);
});

test("the relaxation keeps every constrained edge monotone", () => {
  const graph = makeGraph();
  const initial = new Map([
    ["in", 0],
    ["a", 1],
    ["b", 2],
    ["c", 3],
    ["deep", 4]
  ]);

  const levels = relaxToMinimalSpan(graph, initial, DEFAULT_MINIMAL_SPAN_POLICY);

  for (const edge of graph.edges) {
    assert.ok(
      levels.get(edge.target) - levels.get(edge.source) >= 1,
      `edge ${edge.id} is not monotone`
    );
  }
});

test("relaxation is invariant to node and edge array permutations", () => {
  const graph = makeGraph();
  const initial = new Map([
    ["in", 0],
    ["a", 1],
    ["b", 2],
    ["c", 3],
    ["deep", 4]
  ]);

  const forward = relaxToMinimalSpan(graph, initial, DEFAULT_MINIMAL_SPAN_POLICY);
  const reversed = relaxToMinimalSpan(
    { nodes: graph.nodes.toReversed(), edges: graph.edges.toReversed() },
    initial,
    DEFAULT_MINIMAL_SPAN_POLICY
  );

  assert.deepEqual([...reversed.entries()].sort(), [...forward.entries()].sort());
});

test("a cycle-broken edge is excluded instead of making the ranking infeasible", () => {
  const graph = {
    nodes: [
      { id: "a", label: "a", kind: "cell" },
      { id: "b", label: "b", kind: "cell" }
    ],
    edges: [
      { id: "a-b", source: "a", target: "b" },
      { id: "b-a", source: "b", target: "a" }
    ]
  };
  const initial = new Map([["a", 1], ["b", 1]]);

  const levels = relaxToMinimalSpan(graph, initial, DEFAULT_MINIMAL_SPAN_POLICY);

  assert.equal(levels.get("a"), levels.get("b"));
});

test("the layout policy exposes the layering knobs with bounded values", () => {
  const policy = normalizeLayoutPolicy();
  assert.equal(policy.features.minimalSpanLayering, false);
  assert.equal(policy.layering.boundaryAnchor, "constrained");
  assert.equal(policy.layering.anchorPrimaryPorts, true);
  assert.equal(policy.layering.relaxationSweeps, 8);
  assert.equal(policy.layering.wholeCarrierMinimumFanout, 2);
  assert.equal(policy.layering.wholeCarrierMinimumSpan, 6);

  const clamped = normalizeLayoutPolicy({ layering: { relaxationSweeps: 9999 } });
  assert.equal(clamped.layering.relaxationSweeps, 64);
  assert.equal(normalizeLayoutPolicy({
    layering: { wholeCarrierMinimumFanout: 0 }
  }).layering.wholeCarrierMinimumFanout, 1);
  assert.equal(normalizeLayoutPolicy({
    layering: { wholeCarrierMinimumSpan: 1 }
  }).layering.wholeCarrierMinimumSpan, 2);
  const disabled = normalizeLayoutPolicy({
    features: { minimalSpanLayering: false },
    layering: { boundaryAnchor: "source" }
  });
  assert.equal(disabled.features.minimalSpanLayering, false);
  assert.equal(disabled.layering.boundaryAnchor, "source");
});

function makeGraph() {
  return {
    nodes: [
      { id: "in", label: "in", kind: "focus-input" },
      { id: "a", label: "a", kind: "cell" },
      { id: "b", label: "b", kind: "cell" },
      { id: "c", label: "c", kind: "cell" },
      { id: "deep", label: "deep", kind: "cell" }
    ],
    edges: [
      { id: "in-deep", source: "in", target: "deep" },
      { id: "a-b", source: "a", target: "b" },
      { id: "b-c", source: "b", target: "c" },
      { id: "c-deep", source: "c", target: "deep" }
    ]
  };
}
