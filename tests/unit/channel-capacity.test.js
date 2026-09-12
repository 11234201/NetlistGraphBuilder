import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateIntervalLanes,
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
