import assert from "node:assert/strict";
import test from "node:test";
import { orderPhysicalNetCarriers } from "../../src/layout/layered/carrier_ordering.js";

test("physical carriers follow the median rank of their branch anchors", () => {
  const result = orderPhysicalNetCarriers(makeLayeredGraph());

  assert.deepEqual(result.boundaries.map((boundary) => ({
    boundaryColumn: boundary.boundaryColumn,
    carriers: boundary.carriers.map((carrier) => ({
      id: carrier.id,
      preferredRank: carrier.preferredRank,
      order: carrier.order
    }))
  })), [
    {
      boundaryColumn: 0,
      carriers: [
        { id: "carrier:upper:0", preferredRank: 0, order: 0 },
        { id: "carrier:lower:0", preferredRank: 2, order: 1 }
      ]
    }
  ]);
  assert.deepEqual(result.diagnostics, []);
});

test("carrier ordering is invariant to carrier and edge permutations", () => {
  const graph = makeLayeredGraph();
  const reversed = {
    ...graph,
    orientedEdges: graph.orientedEdges.toReversed(),
    carriers: graph.carriers.toReversed()
  };

  assert.deepEqual(orderPhysicalNetCarriers(reversed), orderPhysicalNetCarriers(graph));
});

test("missing anchors sort last and report a deterministic diagnostic", () => {
  const graph = makeLayeredGraph();
  graph.carriers.push({
    id: "carrier:missing:0",
    netGroupKey: "missing",
    boundaryColumn: 0,
    leftLevel: 0,
    rightLevel: 1,
    logicalEdgeIds: ["missing"]
  });

  const result = orderPhysicalNetCarriers(graph);

  assert.equal(result.boundaries[0].carriers.at(-1).id, "carrier:missing:0");
  assert.deepEqual(result.diagnostics, [
    { code: "layered-carrier-anchor-missing", carrierId: "carrier:missing:0" }
  ]);
});

function makeLayeredGraph() {
  return {
    layers: [
      { level: 0, nodes: [{ id: "upper-source" }, { id: "lower-source" }] },
      {
        level: 1,
        nodes: [
          { id: "dummy:upper-far:1" },
          { id: "upper-near" },
          { id: "lower-near" },
          { id: "dummy:lower-far:1" }
        ]
      }
    ],
    orientedEdges: [
      { id: "upper-far", source: "upper-source", target: "upper-far-target" },
      { id: "upper-near-edge", source: "upper-source", target: "upper-near" },
      { id: "lower-near-edge", source: "lower-source", target: "lower-near" },
      { id: "lower-far", source: "lower-source", target: "lower-far-target" }
    ],
    logicalChains: {
      dummies: [
        { id: "dummy:upper-far:1", realEdgeId: "upper-far", level: 1 },
        { id: "dummy:lower-far:1", realEdgeId: "lower-far", level: 1 }
      ]
    },
    carriers: [
      {
        id: "carrier:lower:0",
        netGroupKey: "lower",
        boundaryColumn: 0,
        leftLevel: 0,
        rightLevel: 1,
        logicalEdgeIds: ["lower-near-edge", "lower-far"]
      },
      {
        id: "carrier:upper:0",
        netGroupKey: "upper",
        boundaryColumn: 0,
        leftLevel: 0,
        rightLevel: 1,
        logicalEdgeIds: ["upper-far", "upper-near-edge"]
      }
    ]
  };
}
