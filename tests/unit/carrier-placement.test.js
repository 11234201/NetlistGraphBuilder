import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCarrierPlacementSlots,
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

test("placement can reserve carriers only above a physical fanout threshold", () => {
  const graph = makeLayeredGraph();
  const below = buildCarrierPlacementLayers(graph, { minimumFanout: 2 });
  graph.carrierBoundaries[0].carriers[0].physicalNetFanout = 2;
  const atThreshold = buildCarrierPlacementLayers(graph, { minimumFanout: 2 });

  assert.equal(below.layers[1].entries.some((entry) => entry.kind === CARRIER_SLOT_KIND), false);
  assert.equal(atThreshold.layers[1].entries.some((entry) => entry.kind === CARRIER_SLOT_KIND), true);
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

test("carrier slots shift only the suffix below them and resolve stable anchors", () => {
  const placement = buildCarrierPlacementLayers(makeLayeredGraph(), { carrierSpan: 24 });
  const nodes = [
    { id: "source", level: 0, y: 10, height: 20 },
    { id: "upper", level: 1, y: 10, height: 20 },
    { id: "lower", level: 1, y: 38, height: 20 }
  ];

  const applied = applyCarrierPlacementSlots(nodes, placement.layers);

  assert.equal(nodes.find((node) => node.id === "upper").y, 10);
  assert.equal(nodes.find((node) => node.id === "lower").y, 62);
  assert.equal(applied.carrierYById.get("carrier:clk:0"), 42);
  assert.equal(applied.totalShift, 24);
  assert.deepEqual(applied.diagnostics, []);

  nodes.find((node) => node.id === "lower").y += 12;
  const resolved = applyCarrierPlacementSlots(nodes, placement.layers, { applyShift: false });
  assert.equal(nodes.find((node) => node.id === "lower").y, 74);
  assert.equal(resolved.carrierYById.get("carrier:clk:0"), 42);
});

test("consecutive physical carriers reserve distinct tracks once", () => {
  const graph = makeLayeredGraph();
  graph.carrierBoundaries[0].carriers.push({
    id: "carrier:reset:0",
    netGroupKey: "reset",
    boundaryColumn: 0,
    preferredRank: 1,
    order: 1,
    logicalEdgeIds: ["reset-edge"]
  });
  const placement = buildCarrierPlacementLayers(graph, { carrierSpan: 20 });
  const nodes = [
    { id: "source", level: 0, y: 10, height: 20 },
    { id: "upper", level: 1, y: 10, height: 20 },
    { id: "lower", level: 1, y: 38, height: 20 }
  ];

  const applied = applyCarrierPlacementSlots(nodes, placement.layers);

  assert.equal(nodes.find((node) => node.id === "lower").y, 78);
  assert.deepEqual([...applied.carrierYById], [
    ["carrier:clk:0", 40],
    ["carrier:reset:0", 60]
  ]);
});

test("entry-order placement makes the logical order geometrically authoritative", () => {
  const placement = buildCarrierPlacementLayers(makeLayeredGraph(), { carrierSpan: 24 });
  const nodes = [
    { id: "source", level: 0, y: 10, height: 20 },
    { id: "upper", level: 1, y: 100, height: 20 },
    { id: "lower", level: 1, y: 10, height: 20 }
  ];

  const applied = applyCarrierPlacementSlots(nodes, placement.layers, {
    enforceEntryOrder: true,
    nodeGap: 8
  });

  assert.equal(nodes.find((node) => node.id === "upper").y, 10);
  assert.equal(applied.carrierYById.get("carrier:clk:0"), 50);
  assert.equal(nodes.find((node) => node.id === "lower").y, 62);
});

test("actual-gap placement preserves geometric node order", () => {
  const placement = buildCarrierPlacementLayers(makeLayeredGraph(), { carrierSpan: 24 });
  const nodes = [
    { id: "source", level: 0, y: 10, height: 20 },
    { id: "upper", level: 1, y: 100, height: 20 },
    { id: "lower", level: 1, y: 10, height: 20 }
  ];

  const applied = applyCarrierPlacementSlots(nodes, placement.layers, {
    useActualGaps: true
  });

  assert.equal(nodes.find((node) => node.id === "lower").y, 10);
  assert.equal(nodes.find((node) => node.id === "upper").y, 100);
  assert.equal(applied.carrierYById.get("carrier:clk:0"), 42);
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
