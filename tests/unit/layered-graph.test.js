import assert from "node:assert/strict";
import test from "node:test";
import { buildLayeredGraph } from "../../src/layout/layered/layered_graph.js";

test("layered graph combines reversible cycles, unit-span chains, and physical carriers", () => {
  const graph = makeGraph();
  const snapshot = structuredClone(graph);
  const layered = buildLayeredGraph(graph);

  assert.deepEqual(graph, snapshot);
  assert.ok(layered.orientedEdges.some((edge) => edge.reversedForLayout));
  assert.ok(layered.logicalChains.dummies.length > 0);
  assert.ok(layered.carriers.length > 0);
  assert.equal(layered.realEdges[0], graph.edges[0]);
  assert.equal(allSegmentsAreUnitSpan(layered), true);
});

test("layered graph is invariant to source array permutations", () => {
  const graph = makeGraph();
  const forward = summarize(buildLayeredGraph(graph));
  const reversed = summarize(buildLayeredGraph({
    nodes: graph.nodes.toReversed(),
    edges: graph.edges.toReversed()
  }));
  assert.deepEqual(reversed, forward);
});

function makeGraph() {
  return {
    nodes: ["a", "b", "c", "d", "e"].map((id) => ({ id, label: id, kind: "cell" })),
    edges: [
      { id: "ab", source: "a", target: "b", net: "ab" },
      { id: "bc", source: "b", target: "c", net: "bc" },
      { id: "ca", source: "c", target: "a", net: "ca" },
      { id: "ad1", source: "a", target: "d", net: "fan" },
      { id: "ad2", source: "a", target: "e", net: "fan" },
      { id: "de", source: "d", target: "e", net: "de" }
    ]
  };
}

function allSegmentsAreUnitSpan(layered) {
  const dummyLevel = new Map(layered.logicalChains.dummies.map((node) => [node.id, node.level]));
  return layered.logicalChains.orderingEdges.every((edge) => {
    const source = layered.levels.get(edge.source) ?? dummyLevel.get(edge.source);
    const target = layered.levels.get(edge.target) ?? dummyLevel.get(edge.target);
    return target - source === 1;
  });
}

function summarize(layered) {
  return {
    layers: layered.layers.map((layer) => ({
      level: layer.level,
      ids: layer.nodes.map((node) => node.id)
    })),
    edges: layered.orientedEdges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })),
    carriers: layered.carriers,
    diagnostics: layered.diagnostics
  };
}
