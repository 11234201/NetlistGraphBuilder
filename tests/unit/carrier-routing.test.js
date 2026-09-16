import assert from "node:assert/strict";
import test from "node:test";
import { buildCarrierPhysicalNetRoutes } from "../../src/layout/layered/carrier_routing.js";

test("carrier routing joins long fanout branches as one validated physical tree", () => {
  const result = buildCarrierPhysicalNetRoutes(
    makeLayeredGraph(),
    makeNodes(),
    new Map([
      ["carrier:n:0", 80],
      ["carrier:n:1", 80]
    ])
  );

  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].edges.length, 2);
  assert.equal(result.groups[0].commit.status, "routed");
  assert.deepEqual(result.groups[0].edges.map((edge) => edge.points), [
    [{ x: 80, y: 56 }, { x: 140, y: 56 }, { x: 140, y: 80 }, { x: 340, y: 80 }, { x: 340, y: 16 }, { x: 400, y: 16 }],
    [{ x: 80, y: 56 }, { x: 140, y: 56 }, { x: 140, y: 80 }, { x: 340, y: 80 }, { x: 340, y: 144 }, { x: 400, y: 144 }]
  ]);
  assert.deepEqual(result.diagnostics, []);
});

test("carrier routing does not partially publish a group with invalid geometry", () => {
  const nodes = makeNodes();
  nodes.push({ id: "block", level: 1, x: 200, y: 70, width: 80, height: 20, ports: [] });
  const result = buildCarrierPhysicalNetRoutes(
    makeLayeredGraph(),
    nodes,
    new Map([["carrier:n:0", 80], ["carrier:n:1", 80]])
  );

  assert.equal(result.groups[0].commit.status, "unroutable");
  assert.ok(result.diagnostics.some((item) =>
    item.code === "layered-carrier-physical-net-invalid"));
});

test("carrier routing produces bounded slot-offset variants", () => {
  const result = buildCarrierPhysicalNetRoutes(
    makeLayeredGraph(),
    makeNodes(),
    new Map([["carrier:n:0", 80], ["carrier:n:1", 80]]),
    { anchorOffsets: [0, -4, 4] }
  );

  assert.deepEqual(result.groups[0].variants.map((variant) => variant.offset), [0, -4, 4]);
  assert.ok(result.groups[0].variants.every((variant) => variant.commit.status === "routed"));
  assert.deepEqual(
    result.groups[0].variants.map((variant) => variant.edges[0].points[2].y),
    [80, 76, 84]
  );
});

test("terminal cells define the right boundary instead of localized inputs", () => {
  const graph = makeLayeredGraph();
  graph.carrierBoundaries[1].carriers = [{
    id: "carrier:n:1",
    terminatingEdgeIds: ["a", "b"]
  }];
  const nodes = makeNodes();
  nodes.push({
    id: "localized-input",
    kind: "focus-input",
    level: 2,
    x: 300,
    y: 200,
    width: 40,
    height: 20,
    ports: []
  });
  const result = buildCarrierPhysicalNetRoutes(
    graph,
    nodes,
    new Map([["carrier:n:0", 80], ["carrier:n:1", 80]])
  );

  assert.equal(result.carrierXById.get("carrier:n:1"), 376);
});

test("the first carrier stays next to its physical source", () => {
  const graph = makeLayeredGraph();
  graph.carrierBoundaries[0].carriers = [{
    id: "carrier:n:0",
    sourceNodeId: "src",
    previousCarrierId: null
  }];
  const result = buildCarrierPhysicalNetRoutes(
    graph,
    makeNodes(),
    new Map([["carrier:n:0", 80], ["carrier:n:1", 80]])
  );

  assert.equal(result.carrierXById.get("carrier:n:0"), 104);
});

test("wide boundaries expose more than the legacy 65 carrier tracks", () => {
  const carriers = Array.from({ length: 80 }, (_, index) => ({
    id: `carrier:n${index}:0`,
    sourceNodeId: "src",
    boundaryColumn: 0,
    order: index,
    logicalEdgeIds: [`edge:${index}`]
  }));
  const orientedEdges = carriers.map((carrier, index) => ({
    id: carrier.logicalEdgeIds[0],
    source: "src",
    target: "target",
    net: `n${index}`,
    physicalNetKey: `src\u0000n${index}`
  }));
  const result = buildCarrierPhysicalNetRoutes({
    orientedEdges,
    carriers,
    carrierBoundaries: [{
      boundaryColumn: 0,
      leftLevel: 0,
      rightLevel: 1,
      carriers
    }]
  }, [
    { id: "src", kind: "cell", level: 0, x: 0, y: 0, width: 80, height: 32, ports: [] },
    { id: "target", kind: "cell", level: 1, x: 2000, y: 0, width: 80, height: 32, ports: [] }
  ], new Map(carriers.map((carrier, index) => [carrier.id, 40 + index * 8])));

  assert.equal(result.carrierXById.size, 80);
  assert.equal(new Set(result.carrierXById.values()).size, 80);
});

function makeLayeredGraph() {
  const edges = [
    { id: "a", source: "src", target: "a", sourcePin: "Z", targetPin: "A", net: "n", physicalNetKey: "src\0n" },
    { id: "b", source: "src", target: "b", sourcePin: "Z", targetPin: "A", net: "n", physicalNetKey: "src\0n" }
  ];
  return {
    orientedEdges: edges,
    carriers: [
      { id: "carrier:n:0", boundaryColumn: 0, logicalEdgeIds: ["a", "b"] },
      { id: "carrier:n:1", boundaryColumn: 1, logicalEdgeIds: ["a", "b"] }
    ],
    carrierBoundaries: [
      {
        boundaryColumn: 0,
        leftLevel: 0,
        rightLevel: 1,
        carriers: [{ id: "carrier:n:0", order: 0 }]
      },
      {
        boundaryColumn: 1,
        leftLevel: 1,
        rightLevel: 2,
        carriers: [{ id: "carrier:n:1", order: 0 }]
      }
    ]
  };
}

function makeNodes() {
  return [
    { id: "src", kind: "cell", level: 0, x: 0, y: 40, width: 80, height: 32,
      ports: [{ pin: "Z", direction: "output", side: "right", x: 80, y: 16 }] },
    { id: "upper", kind: "cell", level: 1, x: 200, y: 0, width: 80, height: 32, ports: [] },
    { id: "lower", kind: "cell", level: 1, x: 200, y: 128, width: 80, height: 32, ports: [] },
    { id: "a", kind: "cell", level: 2, x: 400, y: 0, width: 80, height: 32,
      ports: [{ pin: "A", direction: "input", side: "left", x: 0, y: 16 }] },
    { id: "b", kind: "cell", level: 2, x: 400, y: 128, width: 80, height: 32,
      ports: [{ pin: "A", direction: "input", side: "left", x: 0, y: 16 }] }
  ];
}
