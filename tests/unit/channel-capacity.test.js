import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateIntervalLanes,
  applyRoutingCapacityExpansion,
  buildPhysicalNetDemands,
  buildRoutingCapacityPlan,
  computeTopWireHeadroom,
  MAX_PLACEMENT_OUTER_LANES,
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

test("capacity plan records bounded escape ranges only for group boundary endpoints", () => {
  const nodes = [
    { id: "source", kind: "group", level: 0, x: 0, y: 40, width: 80, height: 32,
      ports: [{ pin: "Z", direction: "output", side: "right", x: 80, y: 16 }] },
    { id: "target", kind: "group", level: 1, x: 240, y: 72, width: 80, height: 32,
      ports: [{ pin: "A", direction: "input", side: "left", x: 0, y: 16 }] }
  ];
  const graph = {
    nodes,
    edges: [{ id: "e", source: "source", target: "target", sourcePin: "Z", targetPin: "A", net: "n" }]
  };
  const plan = buildRoutingCapacityPlan(graph, new Map([
    ["source", 0], ["target", 1]
  ]), nodes, null, { routingGeometry: normalizeRoutingGeometry({ groupBoundaryLanePitch: 10 }) });
  const assignment = plan.allocationByNet.get("source\u0000n")
    .find((item) => item.channelId === "inter-layer:0->1");

  assert.ok(assignment?.sourceEscapeInterval);
  assert.equal(assignment.sourceEscapeInterval.side, "right");
  assert.deepEqual(assignment.targetEscapeRanges, [{ side: "left", minimum: 136, maximum: 232 }]);
  const cluster = plan.boundaryClusterByKey.get(assignment.boundaryClusterKey);
  assert.equal(cluster.sourceEscapeMinimum, 88);
  assert.equal(cluster.sourceEscapeMaximum, 184);
  assert.equal(cluster.targetEscapeMinimum, 136);
  assert.equal(cluster.targetEscapeMaximum, 232);
  assert.deepEqual(cluster.sourceNodeIds, ["source"]);
  assert.deepEqual(cluster.targetNodeIds, ["target"]);
  assert.deepEqual(plan.boundaryClusterByKey.get(cluster.boundaryClusterKey), cluster);
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

test("top wire headroom follows physical demand with a bounded placement cap", () => {
  const geometry = normalizeRoutingGeometry({ wireLanePitch: 20, nodeClearance: 10 });
  const bounded = computeTopWireHeadroom(4, geometry, 48, 80);
  assert.equal(bounded.reservedLaneCount, 4);
  assert.equal(bounded.overflowLaneCount, 0);
  assert.equal(bounded.capacityHeadroom, 48 + 10 + 3 * 20);
  assert.equal(bounded.topWireSpace, Math.max(80, 48 + 10 + 3 * 20));

  const overflow = computeTopWireHeadroom(MAX_PLACEMENT_OUTER_LANES + 7, geometry, 48, 0);
  assert.equal(overflow.reservedLaneCount, MAX_PLACEMENT_OUTER_LANES);
  assert.equal(overflow.overflowLaneCount, 7);
  assert.ok(overflow.topWireSpace < 48 + 7 + (MAX_PLACEMENT_OUTER_LANES + 7) * 20);
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

test("row-gap planning skips already-open gaps instead of allocating one lane per long net", () => {
  const nodes = [
    { id: "upper", kind: "group", level: 1, x: 160, y: 40, width: 80, height: 32,
      ports: [{ pin: "A", direction: "input", side: "left", x: 0, y: 16 }] },
    { id: "lower", kind: "group", level: 1, x: 160, y: 172, width: 80, height: 32,
      ports: [{ pin: "A", direction: "input", side: "left", x: 0, y: 16 }] }
  ];
  const edges = [];
  const levels = new Map([["upper", 1], ["lower", 1]]);
  for (let index = 0; index < 65; index += 1) {
    const source = { id: `src-${index}`, kind: "cell", level: 0, x: 0, y: index * 40,
      width: 80, height: 32,
      ports: [{ pin: "Z", direction: "output", side: "right", x: 80, y: 16 }] };
    const target = { id: `sink-${index}`, kind: "cell", level: 2, x: 320, y: index * 40,
      width: 80, height: 32,
      ports: [{ pin: "A", direction: "input", side: "left", x: 0, y: 16 }] };
    nodes.push(source, target);
    levels.set(source.id, 0);
    levels.set(target.id, 2);
    edges.push({ id: `e-${index}`, source: source.id, target: target.id,
      sourcePin: "Z", targetPin: "A", net: `n-${index}` });
  }
  const plan = buildRoutingCapacityPlan({ nodes, edges }, levels, nodes, null, {
    routingGeometry: normalizeRoutingGeometry()
  });
  assert.equal(plan.channels.some((channel) => channel.kind === "row-gap"), false);
});
