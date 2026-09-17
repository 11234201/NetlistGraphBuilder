import assert from "node:assert/strict";
import test from "node:test";
import { buildPhysicalNetCarriers } from "../../src/layout/layered/physical_net_carriers.js";

test("one fanout net owns one carrier per crossed boundary", () => {
  const graph = {
    edges: [
      { id: "e1", source: "s", target: "near", net: "clk" },
      { id: "e2", source: "s", target: "far1", net: "clk" },
      { id: "e3", source: "s", target: "far2", net: "clk" }
    ]
  };
  const levels = new Map([["s", 0], ["near", 1], ["far1", 3], ["far2", 3], ["middle", 2]]);

  const result = buildPhysicalNetCarriers(graph, levels);

  assert.equal(result.carriers.length, 3);
  assert.deepEqual(result.carriers.map((carrier) => carrier.logicalEdgeIds), [
    ["e1", "e2", "e3"],
    ["e2", "e3"],
    ["e2", "e3"]
  ]);
  assert.deepEqual(result.carriers.map((carrier) => carrier.terminatingEdgeIds), [
    ["e1"],
    [],
    ["e2", "e3"]
  ]);
  assert.deepEqual(result.carriers.map((carrier) => carrier.continuingEdgeIds), [
    ["e2", "e3"],
    ["e2", "e3"],
    []
  ]);
  assert.deepEqual(result.carriers.map((carrier) => carrier.previousCarrierId), [
    null,
    result.carriers[0].id,
    result.carriers[1].id
  ]);
  assert.deepEqual(result.carriers.map((carrier) => carrier.nextCarrierId), [
    result.carriers[1].id,
    result.carriers[2].id,
    null
  ]);
  assert.deepEqual(result.carriers.map((carrier) => carrier.sourceNodeId), ["s", "s", "s"]);
  assert.deepEqual(result.carriers.map((carrier) => carrier.physicalNetSpan), [3, 3, 3]);
  assert.deepEqual(result.carriers.map((carrier) => carrier.sourceColumn), [0, 0, 0]);
  assert.equal(new Set(result.carriers.map((carrier) => carrier.netGroupKey)).size, 1);
  assert.deepEqual(result.diagnostics, []);
});

test("carrier construction is invariant to logical edge order", () => {
  const edges = [
    { id: "b", source: "s", target: "t2", net: "n" },
    { id: "a", source: "s", target: "t1", net: "n" }
  ];
  const levels = new Map([["s", 0], ["m", 1], ["t1", 2], ["t2", 2]]);
  assert.deepEqual(
    buildPhysicalNetCarriers({ edges: edges.toReversed() }, levels),
    buildPhysicalNetCarriers({ edges }, levels)
  );
});

test("non-forward groups are diagnosed instead of producing invalid carriers", () => {
  const result = buildPhysicalNetCarriers({
    edges: [{ id: "back", source: "right", target: "left", net: "n" }]
  }, new Map([["left", 0], ["right", 1]]));
  assert.equal(result.carriers.length, 0);
  assert.deepEqual(result.diagnostics.map((item) => item.code), ["layered-carrier-non-forward-edge"]);
});
