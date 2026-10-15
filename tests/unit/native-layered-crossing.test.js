import assert from "node:assert/strict";
import test from "node:test";
import { CountLayerCrossings, MinimizeCrossings } from "../reference/retired_native_layered/crossing_minimization.js";

test("bounded sweeps improve or retain the stable initial order", () => {
  const proper = MakeProper();
  const initial = proper.layers.map((layer) => ({ rank: layer.rank, nodeKeys: layer.nodes.map((node) => node.key) }));
  assert.equal(CountLayerCrossings(initial, proper.segments), 1);
  const result = MinimizeCrossings(proper, { sweeps: 4, transposePasses: 2 });
  assert.ok(result.crossings <= result.initialCrossings);
  assert.equal(result.crossings, 0);
  assert.equal(result.completedSweeps, 4);
});

test("crossing minimization is permutation stable and bounded", () => {
  const proper = MakeProper();
  const reversed = {
    ...proper,
    layers: proper.layers.map((layer) => ({ ...layer, nodes: layer.nodes.toReversed() })),
    segments: proper.segments.toReversed()
  };
  // Proper layering itself provides canonical node order. Restore that phase's
  // contract before comparing segment permutations only.
  reversed.layers = proper.layers;
  const first = MinimizeCrossings(proper, { sweeps: 3, transposePasses: 1 });
  const second = MinimizeCrossings(reversed, { sweeps: 3, transposePasses: 1 });
  assert.deepEqual(second, first);
  assert.equal(first.sweepLimit, 3);
  assert.equal(first.transposePassLimit, 1);
});

test("an already crossing-free canonical order skips every sweep", () => {
  const proper = {
    layers: [
      { rank: 0, nodes: [{ key: "a" }, { key: "b" }] },
      { rank: 1, nodes: [{ key: "c" }, { key: "d" }] }
    ],
    segments: [
      { key: "a-c", sourceKey: "a", targetKey: "c", boundary: 0 },
      { key: "b-d", sourceKey: "b", targetKey: "d", boundary: 0 }
    ]
  };

  const result = MinimizeCrossings(proper, { sweeps: 8, transposePasses: 4 });

  assert.equal(result.initialCrossings, 0);
  assert.equal(result.crossings, 0);
  assert.equal(result.completedSweeps, 0);
  assert.deepEqual(result.layers.map((layer) => layer.nodeKeys), [["a", "b"], ["c", "d"]]);
});

function MakeProper() {
  return {
    layers: [
      { rank: 0, nodes: [{ key: "a" }, { key: "b" }] },
      { rank: 1, nodes: [{ key: "c" }, { key: "d" }] }
    ],
    segments: [
      { key: "a-d", sourceKey: "a", targetKey: "d", boundary: 0 },
      { key: "b-c", sourceKey: "b", targetKey: "c", boundary: 0 }
    ]
  };
}
