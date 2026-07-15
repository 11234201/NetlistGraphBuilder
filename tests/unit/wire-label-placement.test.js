import assert from "node:assert/strict";
import test from "node:test";
import { placeWireLabels } from "../../src/layout/wireLabelPlacement.js";

test("wire label collision priority is invariant to edge array order", () => {
  const edges = [
    createEdge("b", "net_b"),
    createEdge("a", "net_a")
  ];

  const forward = placeWireLabels(edges, []);
  const reversed = placeWireLabels(edges.toReversed(), []);

  assert.deepEqual(normalize(reversed), normalize(forward));
  assert.notDeepEqual(forward[0].labelPoint, forward[1].labelPoint);
});

test("wire label placement preserves the caller's edge order", () => {
  const edges = [createEdge("z", "z"), createEdge("a", "a")];

  assert.deepEqual(placeWireLabels(edges, []).map((edge) => edge.id), ["z", "a"]);
});

function createEdge(id, net) {
  return {
    id,
    source: "source",
    target: "target",
    net,
    label: net,
    points: [{ x: 0, y: 40 }, { x: 160, y: 40 }]
  };
}

function normalize(edges) {
  return edges.map((edge) => ({
    id: edge.id,
    labelPoint: edge.labelPoint,
    labelAnchor: edge.labelAnchor,
    showLabel: edge.showLabel
  })).toSorted((left, right) => left.id.localeCompare(right.id));
}
