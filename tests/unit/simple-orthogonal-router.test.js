import assert from "node:assert/strict";
import test from "node:test";
import { analyzeLayoutIntent } from "../../src/layout/layoutIntent.js";
import { normalizeRoutingGeometry } from "../../src/layout/channelCapacity.js";
import { routeSimpleEdges } from "../../src/layout/simpleOrthogonalRouter.js";

test("simple router binds a skip-level edge to its source-adjacent capacity boundary", () => {
  const nodes = [
    {
      id: "source",
      kind: "cell",
      level: 0,
      x: 0,
      y: 48,
      width: 80,
      height: 40,
      ports: [{ pin: "Z", direction: "output", side: "right", x: 80, y: 20 }]
    },
    {
      id: "middle",
      kind: "cell",
      level: 1,
      x: 180,
      y: 112,
      width: 80,
      height: 40,
      ports: [{ pin: "A", direction: "input", side: "left", x: 0, y: 20 }]
    },
    {
      id: "target",
      kind: "cell",
      level: 2,
      x: 360,
      y: 176,
      width: 80,
      height: 40,
      ports: [{ pin: "A", direction: "input", side: "left", x: 0, y: 20 }]
    }
  ];
  const graph = {
    nodes,
    edges: [{
      id: "edge",
      source: "source",
      target: "target",
      sourcePin: "Z",
      targetPin: "A",
      net: "n"
    }]
  };
  const levels = new Map(nodes.map((node) => [node.id, node.level]));
  const layoutIntent = analyzeLayoutIntent(graph, levels);
  const routingCapacity = {
    allocationByNet: new Map([["source\u0000n", [
      {
        channelId: "inter-layer:0->1",
        coordinate: 42,
        laneIndex: 0,
        boundaryClusterKey: "source-boundary",
        sourceEscapeSide: "right",
        targetEscapeSides: ["left"]
      },
      {
        channelId: "inter-layer:1->2",
        coordinate: 154,
        laneIndex: 1,
        boundaryClusterKey: "target-boundary",
        sourceEscapeSide: "right",
        targetEscapeSides: ["left"]
      },
      {
        channelId: "outer-top",
        coordinate: null,
        laneIndex: null,
        capacityOverflow: true,
        boundaryClusterKey: "overflow-boundary"
      }
    ]]]),
    metrics: {
      physicalNetCount: 1,
      channelCount: 2,
      allocatedLaneCount: 2,
      expandedChannelCount: 0,
      boundaryClusterCount: 2,
      maximumBoundaryClusterDemand: 1,
      topWireHeadroom: null
    }
  };

  const [edge] = routeSimpleEdges(graph, nodes, {
    layoutIntent,
    routePlan: {
      edges: new Map([["edge", {
        kind: "long",
        topLane: 0,
        sourceLane: 0,
        targetLane: 0
      }]])
    },
    routingCapacity,
    wireLanePitch: 24,
    topWireLanePitch: 24,
    routingGeometry: normalizeRoutingGeometry(),
    margin: 48
  });

  assert.equal(edge.capacityBoundaryClusterKey, "source-boundary");
  assert.equal(edge.capacityChannelId, "inter-layer:0->1");
  assert.equal(edge.capacityOverflow, false);
  assert.ok(edge.points.length >= 2);
});

test("simple router uses an explicit overflow corridor after a placement cap", () => {
  const nodes = [
    { id: "source", kind: "group", level: 0, x: 0, y: 48, width: 80, height: 40,
      ports: [{ pin: "Z", direction: "output", side: "right", x: 80, y: 20 }] },
    { id: "middle", kind: "cell", level: 1, x: 180, y: 112, width: 80, height: 40,
      ports: [{ pin: "A", direction: "input", side: "left", x: 0, y: 20 }] },
    { id: "target", kind: "group", level: 2, x: 360, y: 176, width: 80, height: 40,
      ports: [{ pin: "A", direction: "input", side: "left", x: 0, y: 20 }] }
  ];
  const graph = {
    nodes,
    edges: [{ id: "edge", source: "source", target: "target", sourcePin: "Z", targetPin: "A", net: "n" }]
  };
  const levels = new Map(nodes.map((node) => [node.id, node.level]));
  const routingCapacity = {
    allocationByNet: new Map([["source\u0000n", [
      {
        channelId: "inter-layer:0->1",
        coordinate: null,
        laneIndex: null,
        capacityOverflow: true,
        placementOverflow: true,
        overflowKind: "placement",
        requestedLaneIndex: 128,
        placementLaneLimit: 128,
        boundaryClusterKey: "source-blocked"
      },
      {
        channelId: "inter-layer:1->2",
        coordinate: 154,
        laneIndex: 1,
        boundaryClusterKey: "later-boundary"
      }
    ]]]),
    metrics: { physicalNetCount: 1, channelCount: 2, allocatedLaneCount: 2 }
  };

  for (const strictRouting of [false, true]) {
    const [edge] = routeSimpleEdges(graph, nodes, {
      layoutIntent: analyzeLayoutIntent(graph, levels),
      routePlan: { edges: new Map([["edge", {
        kind: "long",
        sourceLane: 999,
        targetLane: 999,
        topLane: 999
      }]]) },
      routingCapacity,
      wireLanePitch: 24,
      topWireLanePitch: 24,
      routingGeometry: normalizeRoutingGeometry(),
      margin: 48,
      strictRouting
    });
    assert.equal(edge.routeKind, "capacity-overflow-corridor");
    assert.equal(edge.routeStatus, "routed");
    assert.ok(edge.points.length >= 2);
    assert.equal(edge.capacityChannelId, "inter-layer:0->1");
    assert.equal(edge.capacityOverflow, true);
    assert.equal(edge.capacityOverflowKind, "placement");
    assert.equal(edge.capacityBlocked, true);
    assert.equal(edge.routeDiagnostics[0].code, "routing-capacity-overflow-corridor");
    assert.equal(edge.routeDiagnostics[0].channelId, "inter-layer:0->1");
  }
});

test("a capacity-capped boundary still permits a hard-validated direct route", () => {
  const nodes = [
    { id: "source", kind: "group", level: 0, x: 0, y: 48, width: 80, height: 40,
      ports: [{ pin: "Z", direction: "output", side: "right", x: 80, y: 20 }] },
    { id: "target", kind: "group", level: 1, x: 200, y: 48, width: 80, height: 40,
      ports: [{ pin: "A", direction: "input", side: "left", x: 0, y: 20 }] }
  ];
  const graph = {
    nodes,
    edges: [{ id: "edge", source: "source", target: "target", sourcePin: "Z", targetPin: "A", net: "n" }]
  };
  const levels = new Map(nodes.map((node) => [node.id, node.level]));
  const [edge] = routeSimpleEdges(graph, nodes, {
    layoutIntent: analyzeLayoutIntent(graph, levels),
    routePlan: { edges: new Map([["edge", { kind: "long", sourceLane: 999 }]]) },
    routingCapacity: {
      allocationByNet: new Map([["source\u0000n", [{
        channelId: "inter-layer:0->1",
        coordinate: null,
        laneIndex: null,
        capacityOverflow: true,
        placementOverflow: true,
        overflowKind: "placement",
        boundaryClusterKey: "blocked"
      }]]]),
      metrics: { physicalNetCount: 1, channelCount: 1, allocatedLaneCount: 1 }
    },
    wireLanePitch: 24,
    topWireLanePitch: 24,
    routingGeometry: normalizeRoutingGeometry(),
    margin: 48
  });

  assert.equal(edge.routeKind, "direct");
  assert.equal(edge.routeStatus, "routed");
  assert.equal(edge.capacityBlocked, true);
  assert.equal(edge.capacityOverflow, true);
});

test("simple router commits a complete non-direct fanout tree atomically", () => {
  const nodes = [
    { id: "src", kind: "cell", level: 0, x: 0, y: 60, width: 80, height: 32,
      ports: [{ pin: "Z", direction: "output", side: "right", x: 80, y: 16 }] },
    { id: "a", kind: "cell", level: 1, x: 240, y: 0, width: 80, height: 32,
      ports: [{ pin: "A", direction: "input", side: "left", x: 0, y: 16 }] },
    { id: "b", kind: "cell", level: 1, x: 240, y: 120, width: 80, height: 32,
      ports: [{ pin: "A", direction: "input", side: "left", x: 0, y: 16 }] }
  ];
  const graph = {
    nodes,
    edges: [
      { id: "e1", source: "src", target: "a", sourcePin: "Z", targetPin: "A", net: "n" },
      { id: "e2", source: "src", target: "b", sourcePin: "Z", targetPin: "A", net: "n" }
    ]
  };
  const levels = new Map(nodes.map((node) => [node.id, node.level]));
  const layoutIntent = analyzeLayoutIntent(graph, levels);
  const routed = routeSimpleEdges(graph, nodes, {
    layoutIntent,
    routePlan: {
      edges: new Map(graph.edges.map((edge) => [edge.id, { kind: "channel", lane: 0 }]))
    },
    wireLanePitch: 24,
    topWireLanePitch: 24,
    routingGeometry: normalizeRoutingGeometry(),
    margin: 48
  });
  assert.ok(routed.every((edge) => edge.routeKind === "physical-net-tree"));
  assert.equal(routed.routingMetrics.atomicPhysicalNetTreeCount, 1);
  assert.ok(routed.every((edge) => edge.points[0].x === 80 && edge.points[0].y === 76));
});

test("physical fanout tree uses a vertical approach for top-side targets", () => {
  const nodes = [
    { id: "src", kind: "cell", level: 0, x: 0, y: 96, width: 80, height: 32,
      ports: [{ pin: "Z", direction: "output", side: "right", x: 80, y: 16 }] },
    { id: "top", kind: "cell", level: 1, x: 240, y: 0, width: 80, height: 64,
      ports: [{ pin: "A", direction: "input", side: "top", x: 40, y: 0 }] },
    { id: "side", kind: "cell", level: 1, x: 240, y: 160, width: 80, height: 32,
      ports: [{ pin: "A", direction: "input", side: "left", x: 0, y: 16 }] }
  ];
  const graph = {
    nodes,
    edges: [
      { id: "e1", source: "src", target: "top", sourcePin: "Z", targetPin: "A", net: "n" },
      { id: "e2", source: "src", target: "side", sourcePin: "Z", targetPin: "A", net: "n" }
    ]
  };
  const levels = new Map(nodes.map((node) => [node.id, node.level]));
  const routed = routeSimpleEdges(graph, nodes, {
    layoutIntent: analyzeLayoutIntent(graph, levels),
    routePlan: {
      edges: new Map(graph.edges.map((edge) => [edge.id, { kind: "channel", lane: 0 }]))
    },
    wireLanePitch: 24,
    topWireLanePitch: 24,
    routingGeometry: normalizeRoutingGeometry(),
    margin: 48
  });

  assert.ok(routed.every((edge) => edge.routeKind === "physical-net-tree"));
  assert.ok(routed.every((edge) => edge.routeStatus === "routed"));
  const topEdge = routed.find((edge) => edge.target === "top");
  assert.ok(topEdge.points.some((point, index) => {
    const next = topEdge.points[index + 1];
    return next && Math.abs(point.x - next.x) < 0.5 &&
      Math.abs(point.x - 280) < 0.5 && point.y < 0 && next.y <= 0;
  }));
});

test("collapsed group sources can use one validated physical fanout tree", () => {
  const nodes = [
    { id: "group", kind: "group", level: 0, x: 0, y: 60, width: 80, height: 32,
      ports: [{ pin: "Z", direction: "output", side: "right", x: 80, y: 16 }] },
    { id: "a", kind: "cell", level: 1, x: 240, y: 0, width: 80, height: 32,
      ports: [{ pin: "A", direction: "input", side: "left", x: 0, y: 16 }] },
    { id: "b", kind: "cell", level: 1, x: 240, y: 120, width: 80, height: 32,
      ports: [{ pin: "A", direction: "input", side: "left", x: 0, y: 16 }] }
  ];
  const graph = {
    nodes,
    edges: [
      { id: "e1", source: "group", target: "a", sourcePin: "Z", targetPin: "A", net: "n" },
      { id: "e2", source: "group", target: "b", sourcePin: "Z", targetPin: "A", net: "n" }
    ]
  };
  const levels = new Map(nodes.map((node) => [node.id, node.level]));
  const routed = routeSimpleEdges(graph, nodes, {
    layoutIntent: analyzeLayoutIntent(graph, levels),
    routePlan: {
      edges: new Map(graph.edges.map((edge) => [edge.id, { kind: "channel", lane: 0 }]))
    },
    wireLanePitch: 24,
    topWireLanePitch: 24,
    routingGeometry: normalizeRoutingGeometry(),
    margin: 48
  });

  assert.ok(routed.every((edge) => edge.routeKind === "physical-net-tree"));
  assert.equal(routed.routingMetrics.atomicPhysicalNetTreeCount, 1);
  assert.ok(routed.every((edge) => edge.routeStatus === "routed"));
});

test("a capped capacity boundary uses an atomic overflow tree before per-edge routing", () => {
  const nodes = [
    { id: "src", kind: "cell", level: 0, x: 0, y: 60, width: 80, height: 32,
      ports: [{ pin: "Z", direction: "output", side: "right", x: 80, y: 16 }] },
    { id: "a", kind: "cell", level: 1, x: 240, y: 0, width: 80, height: 32,
      ports: [{ pin: "A", direction: "input", side: "left", x: 0, y: 16 }] },
    { id: "b", kind: "cell", level: 1, x: 240, y: 120, width: 80, height: 32,
      ports: [{ pin: "A", direction: "input", side: "left", x: 0, y: 16 }] }
  ];
  const graph = {
    nodes,
    edges: [
      { id: "e1", source: "src", target: "a", sourcePin: "Z", targetPin: "A", net: "n" },
      { id: "e2", source: "src", target: "b", sourcePin: "Z", targetPin: "A", net: "n" }
    ]
  };
  const levels = new Map(nodes.map((node) => [node.id, node.level]));
  const routed = routeSimpleEdges(graph, nodes, {
    layoutIntent: analyzeLayoutIntent(graph, levels),
    routePlan: { edges: new Map(graph.edges.map((edge) => [edge.id, { kind: "channel", lane: 0 }])) },
    routingCapacity: {
      allocationByNet: new Map([["src\u0000n", [{
        channelId: "inter-layer:0->1",
        coordinate: null,
        laneIndex: null,
        capacityOverflow: true,
        placementOverflow: true,
        overflowKind: "placement",
        boundaryClusterKey: "blocked"
      }]]]),
      metrics: { physicalNetCount: 1, channelCount: 1, allocatedLaneCount: 1 }
    },
    wireLanePitch: 24,
    topWireLanePitch: 24,
    routingGeometry: normalizeRoutingGeometry(),
    margin: 48
  });

  assert.ok(routed.every((edge) => edge.routeKind === "capacity-overflow-tree"));
  assert.ok(routed.every((edge) => edge.routeStatus === "routed"));
  assert.ok(routed.every((edge) => edge.points.length >= 2));
  assert.ok(routed.every((edge) => edge.capacityOverflow === true));
  assert.ok(routed.every((edge) => edge.capacityBlocked === true));
  assert.ok(routed.every((edge) => edge.routeDiagnostics.some((item) =>
    item.code === "routing-capacity-overflow-tree")));
  assert.equal(routed.routingMetrics.atomicPhysicalNetTreeCount || 0, 0);
  assert.equal(routed.routingMetrics.unroutablePhysicalNetCount || 0, 0);
  assert.equal(routed.routingMetrics.overflowUnroutablePhysicalNetCount || 0, 0);
});

test("simple router never commits a node-crossing fallback in ordinary mode", () => {
  const nodes = [
    { id: "source", kind: "cell", level: 0, x: 0, y: 40, width: 80, height: 32,
      ports: [{ pin: "Z", direction: "output", side: "right", x: 80, y: 16 }] },
    { id: "target", kind: "cell", level: 1, x: 200, y: 40, width: 80, height: 32,
      ports: [{ pin: "A", direction: "input", side: "left", x: 0, y: 16 }] },
    // This blocker closes every source-to-target escape; it is intentionally
    // wider/taller than the bounded outer candidate region.
    { id: "blocker", kind: "cell", level: 0, x: 80, y: -10000, width: 120, height: 20000, ports: [] }
  ];
  const graph = {
    nodes,
    edges: [{ id: "edge", source: "source", target: "target", sourcePin: "Z", targetPin: "A", net: "n" }]
  };
  const levels = new Map(nodes.map((node) => [node.id, node.level]));
  const [edge] = routeSimpleEdges(graph, nodes, {
    layoutIntent: analyzeLayoutIntent(graph, levels),
    routePlan: { edges: new Map([["edge", { kind: "long", lane: 0 }]]) },
    wireLanePitch: 24,
    topWireLanePitch: 24,
    routingGeometry: normalizeRoutingGeometry(),
    margin: 48
  });

  assert.equal(edge.routeKind, "unroutable");
  assert.equal(edge.routeStatus, "unroutable");
  assert.deepEqual(edge.points, []);
});
