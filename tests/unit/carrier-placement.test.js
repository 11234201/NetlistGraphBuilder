import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCarrierPlacementLayers,
  CARRIER_SLOT_KIND
} from "../../src/layout/layered/carrier_placement.js";

test("placement replaces logical dummies with one physical carrier slot", () => {
  const result = buildCarrierPlacementLayers(makeLayeredGraph(), { carrierSpan: 18 });
  const middle = result.layers.find((layer) => layer.level === 1);

  assert.deepEqual(middle.entries.map((entry) => entry.id), [
    "upper",
    "slot:carrier:clk:0",
    "lower"
  ]);
  assert.equal(middle.entries.some((entry) => entry.id.startsWith("dummy:")), false);
  assert.equal(middle.entries[1].kind, CARRIER_SLOT_KIND);
  assert.equal(middle.entries[1].minimumSpan, 18);
  assert.deepEqual(result.diagnostics, []);
});

test("fanout branches sharing a physical net do not multiply placement slots", () => {
  const graph = makeLayeredGraph();
  graph.layers[1].nodes.splice(2, 0,
    { id: "dummy:e2:1", kind: "layout-dummy", realEdgeId: "e2" },
    { id: "dummy:e3:1", kind: "layout-dummy", realEdgeId: "e3" });
  graph.carrierBoundaries[0].carriers[0].logicalEdgeIds = ["e1", "e2", "e3"];

  const result = buildCarrierPlacementLayers(graph);
  const carrierSlots = result.layers[1].entries.filter((entry) =>
    entry.kind === CARRIER_SLOT_KIND);

  assert.equal(carrierSlots.length, 1);
});

test("carrier placement is invariant to carrier array order", () => {
  const graph = makeLayeredGraph();
  const reversed = {
    ...graph,
    carrierBoundaries: graph.carrierBoundaries.map((boundary) => ({
      ...boundary,
      carriers: boundary.carriers.toReversed()
    }))
  };

  assert.deepEqual(
    summarize(buildCarrierPlacementLayers(reversed)),
    summarize(buildCarrierPlacementLayers(graph))
  );
});

function makeLayeredGraph() {
  return {
    layers: [
      { level: 0, nodes: [{ id: "source", kind: "cell" }] },
      {
        level: 1,
        nodes: [
          { id: "upper", kind: "cell" },
          { id: "dummy:e1:1", kind: "layout-dummy", realEdgeId: "e1" },
          { id: "lower", kind: "cell" }
        ]
      }
    ],
    carrierBoundaries: [{
      boundaryColumn: 0,
      leftLevel: 0,
      rightLevel: 1,
      carriers: [{
        id: "carrier:clk:0",
        netGroupKey: "clk",
        boundaryColumn: 0,
        preferredRank: 1,
        order: 0,
        logicalEdgeIds: ["e1"]
      }]
    }]
  };
}

function summarize(result) {
  return result.layers.map((layer) => ({
    level: layer.level,
    entries: layer.entries.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      preferredRank: entry.preferredRank
    }))
  }));
}
