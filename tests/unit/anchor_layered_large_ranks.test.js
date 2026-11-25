import assert from "node:assert/strict";
import test from "node:test";
import { optimizeRanks } from "../../src/layout/anchor_layered/network_simplex.js";
import { orderLayers } from "../../src/layout/anchor_layered/p3_ordering.js";

// Exceeds V8's argument-count limit when rank extrema are computed with spread.
const width = 140_000;
const wideIds = Array.from({ length: width }, (_, index) => "leaf-" + index);

test("ranking a wide balanced junction keeps every input rank and layer constraint", () => {
  const ids = [...wideIds, "junction", "output"];
  const edges = wideIds.map(id => ({ id, sourceNodeId: id, targetNodeId: "junction", weight: 1, minimumLength: 1 }));
  edges.push({ id: "out", sourceNodeId: "junction", targetNodeId: "output", weight: width, minimumLength: 1 });
  for (const balanceLayers of [false, true]) {
    const { ranks, evidence } = optimizeRanks(ids, edges, { thoroughness: 1, balanceLayers });
    assert.equal(ranks.size, ids.length);
    assert.ok(wideIds.every(id => ranks.get(id) === 0));
    assert.equal(ranks.get("junction"), 1);
    assert.equal(ranks.get("output"), 2);
    assert.equal(evidence.objectiveWeightedSpan, width * 2);
  }
});

test("ordering a wide layer preserves all nodes without exceeding the stack limit", () => {
  const layers = [{ index: 0, nodeIds: ["root"] }, { index: 1, nodeIds: wideIds }];
  const nodes = layers.flatMap(({ index, nodeIds }) => nodeIds.map(id => ({ id, layer: index, ports: [] })));
  const graph = { nodes, layers, edges: [], logicalEdges: [], chains: [],
    inputDigest: "00000000", options: { thoroughness: 1, randomSeed: 0 } };
  const ordered = orderLayers(graph, { observe: false });
  assert.equal(ordered.phaseData.crossings, 0);
  assert.equal(ordered.layers[1].nodeIds.length, width);
  assert.deepEqual(new Set(ordered.layers[1].nodeIds), new Set(wideIds));
});
