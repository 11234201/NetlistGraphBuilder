import assert from "node:assert/strict";
import test from "node:test";
import {
  applyBalancedLayerPlacement,
  compactOrderedLayer
} from "../../src/layout/layered/balancedPlacement.js";

function node(id, level, order, height = 20, pinY = 10) {
  return {
    id, kind: "cell", label: id, level, order, x: level * 100, y: 0,
    width: 60, height,
    ports: [
      { pin: "A", direction: "input", x: 0, y: pinY },
      { pin: "Y", direction: "output", x: 60, y: pinY }
    ]
  };
}

test("balanced placement centres shorter layers instead of top-aligning them", () => {
  const nodes = [
    node("a0", 0, 0), node("a1", 0, 1), node("a2", 0, 2),
    node("b0", 1, 0)
  ];
  applyBalancedLayerPlacement(nodes, [], [0, 1], { minimumY: 40, gap: 10, sweeps: 0 });

  assert.equal(nodes[0].y, 40);
  assert.equal(nodes[3].y, 70);
});

test("ordered compaction preserves order and minimum separation", () => {
  const nodes = [node("a", 0, 0), node("b", 0, 1), node("c", 0, 2)];
  const result = compactOrderedLayer(nodes, [100, 20, 40], 10, 8);

  assert.ok(result[0] >= 10);
  assert.ok(result[1] >= result[0] + nodes[0].height + 8);
  assert.ok(result[2] >= result[1] + nodes[1].height + 8);
});

test("balanced placement is independent of node and edge array order", () => {
  const original = [node("a", 0, 0), node("b", 0, 1), node("c", 1, 0), node("d", 1, 1)];
  const edges = [
    { id: "ac", source: "a", target: "c", sourcePin: "Y", targetPin: "A" },
    { id: "bd", source: "b", target: "d", sourcePin: "Y", targetPin: "A" }
  ];
  const permuted = original.toReversed().map((entry) => ({
    ...entry,
    ports: entry.ports.map((port) => ({ ...port }))
  }));

  applyBalancedLayerPlacement(original, edges, [0, 1], { minimumY: 10, gap: 8 });
  applyBalancedLayerPlacement(permuted, edges.toReversed(), [0, 1], { minimumY: 10, gap: 8 });

  const first = new Map(original.map((entry) => [entry.id, entry.y]));
  assert.deepEqual(new Map(permuted.map((entry) => [entry.id, entry.y])), first);
});
