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
  assert.equal(edge.capacityChannelId, undefined);
  assert.ok(edge.points.length >= 2);
});
