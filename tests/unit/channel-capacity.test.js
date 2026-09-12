import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateIntervalLanes,
  applyRoutingCapacityExpansion,
  buildPhysicalNetDemands,
  buildRoutingCapacityPlan,
  normalizeRoutingGeometry,
  requiredInterLayerGap,
  requiredRowGap
} from "../../src/layout/channelCapacity.js";

test("interval channel allocation reuses only separated lanes deterministically", () => {
  const demands = [
    { netGroupKey: "b", intervalStart: 20, intervalEnd: 30, priorityClass: 0 },
    { netGroupKey: "a", intervalStart: 0, intervalEnd: 10, priorityClass: 0 },
    { netGroupKey: "c", intervalStart: 11, intervalEnd: 18, priorityClass: 0 }
  ];
  const forward = allocateIntervalLanes(demands, 1, 24);
  const reversed = allocateIntervalLanes(demands.toReversed(), 1, 24);

  assert.equal(forward.laneCount, 2);
  assert.deepEqual(
    forward.assignments.map(({ netGroupKey, laneIndex }) => [netGroupKey, laneIndex]),
    [["a", 0], ["c", 1], ["b", 0]]
  );
  assert.deepEqual(reversed, forward);
});

test("capacity plan counts physical fanout once per inter-layer boundary", () => {
  const graph = {
    nodes: [
      { id: "src", kind: "cell", width: 100, height: 40, x: 0, y: 40, ports: [{ pin: "Z", direction: "output", side: "right", x: 100, y: 20 }] },
      { id: "a", kind: "cell", width: 100, height: 40, x: 180, y: 0, ports: [{ pin: "A", direction: "input", side: "left", x: 0, y: 20 }] },
      { id: "b", kind: "cell", width: 100, height: 40, x: 180, y: 120, ports: [{ pin: "A", direction: "input", side: "left", x: 0, y: 20 }] }
    ],
    edges: [
      { id: "e1", source: "src", target: "a", sourcePin: "Z", targetPin: "A", net: "n" },
      { id: "e2", source: "src", target: "b", sourcePin: "Z", targetPin: "A", net: "n" }
    ]
  };
  const levels = new Map([["src", 0], ["a", 1], ["b", 1]]);
  const plan = buildRoutingCapacityPlan(graph, levels, graph.nodes, null, {
    routingGeometry: normalizeRoutingGeometry({ wireLanePitch: 20 })
  });
  const channel = plan.channels.find((item) => item.kind === "inter-layer");

  assert.equal(plan.netDemands.length, 1);
  assert.equal(channel.laneCount, 1);
  assert.equal(channel.requiredSpan, requiredInterLayerGap(1, plan.routingGeometry));
  assert.equal(plan.metrics.physicalNetCount, 1);
  assert.equal(plan.metrics.boundaryClusterCount, 1);
  assert.ok(plan.channels
    .filter((item) => item.demands.length > 0)
    .every((item) => item.demands[0].boundaryClusterKey));
});

test("capacity plan reuses indexed physical demands across every traversed boundary", () => {
  const nodes = [
    { id: "src", kind: "cell", x: 0, y: 40, width: 100, height: 40,
      ports: [{ pin: "Z", direction: "output", side: "right", x: 100, y: 20 }] },
    { id: "mid", kind: "cell", x: 220, y: 40, width: 100, height: 40,
      ports: [{ pin: "A", direction: "input", side: "left", x: 0, y: 20 }] },
    { id: "sink", kind: "cell", x: 440, y: 100, width: 100, height: 40,
      ports: [{ pin: "A", direction: "input", side: "left", x: 0, y: 20 }] }
  ];
  const graph = {
    nodes,
    edges: [
      { id: "e1", source: "src", target: "sink", sourcePin: "Z", targetPin: "A", net: "n" },
      { id: "e2", source: "src", target: "mid", sourcePin: "Z", targetPin: "A", net: "n" }
    ]
  };
  const plan = buildRoutingCapacityPlan(graph, new Map([
    ["src", 0], ["mid", 1], ["sink", 2]
  ]), nodes, null, { routingGeometry: normalizeRoutingGeometry() });
  const boundaries = plan.channels.filter((channel) => channel.kind === "inter-layer");

  assert.equal(plan.netDemands.length, 1);
  assert.deepEqual(boundaries.map((channel) => channel.demandKeys), [["src\u0000n"], ["src\u0000n"]]);
  assert.equal(plan.metrics.physicalNetCount, 1);
  assert.equal(plan.metrics.boundaryClusterCount, 3);
  assert.equal(new Set(boundaries.map((channel) => channel.demands[0].boundaryClusterKey)).size, 2);
});

test("capacity formulas use named geometry and remain zero for empty channels", () => {
  const geometry = normalizeRoutingGeometry({
    nodeClearance: 10,
    targetApproachClearance: 12,
    minimumVisibleTargetCornerGap: 18,
    portEscapeLength: 20,
    wireLanePitch: 16
  });
  assert.equal(requiredRowGap(0, geometry), 0);
  assert.equal(requiredRowGap(3, geometry), 20 + 2 * 16);
  assert.equal(requiredInterLayerGap(2, geometry), 56 + 16);
  assert.equal(Object.isFrozen(geometry), true);
});

test("row-gap capacity expands only the lower node suffix for a crossing physical net", () => {
  const nodes = [
    { id: "src", kind: "cell", level: 0, x: 0, y: 40, width: 80, height: 32,
      ports: [{ pin: "Z", direction: "output", side: "right", x: 80, y: 16 }] },
    { id: "upper", kind: "group", level: 1, x: 160, y: 40, width: 80, height: 32,
      ports: [{ pin: "A", direction: "input", side: "left", x: 0, y: 16 }] },
    { id: "lower", kind: "group", level: 1, x: 160, y: 76, width: 80, height: 32,
      ports: [{ pin: "A", direction: "input", side: "left", x: 0, y: 16 }] },
    { id: "sink", kind: "cell", level: 2, x: 320, y: 40, width: 80, height: 32,
      ports: [{ pin: "A", direction: "input", side: "left", x: 0, y: 16 }] }
  ];
  const graph = {
    nodes,
    edges: [{ id: "e1", source: "src", target: "sink", sourcePin: "Z", targetPin: "A", net: "n" }]
  };
  const levels = new Map(nodes.map((node) => [node.id, node.level]));
  const geometry = normalizeRoutingGeometry({ nodeClearance: 8, wireLanePitch: 24 });
  const plan = buildRoutingCapacityPlan(graph, levels, nodes, null, {
    routingGeometry: geometry
  });
  const rowGap = plan.channels.find((channel) => channel.kind === "row-gap");

  assert.ok(rowGap);
  assert.equal(rowGap.currentSpan, 4);
  assert.equal(rowGap.laneCount, 1);
  assert.equal(rowGap.requiredSpan, requiredRowGap(1, geometry));
  assert.equal(rowGap.expansion, 12);

  const originalUpperY = nodes.find((node) => node.id === "upper").y;
  const originalLowerY = nodes.find((node) => node.id === "lower").y;
  const originalSinkY = nodes.find((node) => node.id === "sink").y;
  const result = applyRoutingCapacityExpansion(nodes, plan);
  assert.equal(result.expandedRowGaps, 1);
  assert.equal(nodes.find((node) => node.id === "upper").y, originalUpperY);
  assert.equal(nodes.find((node) => node.id === "lower").y, originalLowerY + 12);
  assert.equal(nodes.find((node) => node.id === "sink").y, originalSinkY);
});
