import assert from "node:assert/strict";
import test from "node:test";
import { NativeLayeredLayoutProvider } from "../reference/retired_native_layered/native_layered_layout_provider.js";

test("native provider runs the complete pipeline without mutating its input", () => {
  const graph = MakeGraph();
  const before = structuredClone(graph);
  const result = new NativeLayeredLayoutProvider().layout(graph);
  assert.deepEqual(graph, before);
  assert.equal(result.layoutProvider, "native-layered");
  assert.ok(result.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
  assert.ok(result.edges.every((edge) => edge.points.length >= 2));
  // NLR-10 replaced the retired channel/physical-net router, so "nothing left
  // unroutable" is now expressed by the commit gate's trunk and net verdicts.
  assert.equal(result.layoutMetrics.phases.routing.missingTrunkCount, 0);
  assert.equal(result.layoutMetrics.phases.routing.rejectedNetCount, 0);
});

test("native provider positions and routes identically under graph permutations", () => {
  const graph = MakeGraph();
  const provider = new NativeLayeredLayoutProvider();
  const first = provider.layout(graph);
  const second = provider.layout({ ...graph, nodes: graph.nodes.toReversed(), edges: graph.edges.toReversed() });
  assert.deepEqual(Summarize(second), Summarize(first));
});

function MakeGraph() {
  return {
    moduleName: "m",
    nodes: [
      { id: "in", kind: "input", label: "in" },
      { id: "a", kind: "cell", label: "a", portDescriptors: [{ pin: "A", direction: "input" }, { pin: "Y", direction: "output" }] },
      { id: "b", kind: "cell", label: "b", portDescriptors: [{ pin: "A", direction: "input" }, { pin: "Y", direction: "output" }] },
      { id: "out", kind: "output", label: "out" }
    ],
    edges: [
      { id: "ia", source: "in", target: "a", targetPin: "A", net: "n0" },
      { id: "ab", source: "a", sourcePin: "Y", target: "b", targetPin: "A", net: "n1" },
      { id: "bo", source: "b", sourcePin: "Y", target: "out", net: "n2" }
    ]
  };
}

function Summarize(graph) {
  return {
    nodes: graph.nodes.map(({ id, x, y, width, height }) => ({ id, x, y, width, height })),
    edges: graph.edges.map(({ id, points }) => ({ id, points })),
    // Per-run timing is deliberately excluded; everything else, including slot
    // count, split count and route geometry, must be permutation-invariant.
    metrics: Object.fromEntries(Object.entries(graph.layoutMetrics.phases).map(([name, values]) => {
      const { elapsedMs: _elapsedMs, phaseElapsedMs: _phaseElapsedMs, ...stableValues } = values;
      return [name, stableValues];
    }))
  };
}
