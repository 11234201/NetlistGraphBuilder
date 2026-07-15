import assert from "node:assert/strict";
import test from "node:test";
import { applyPositionedOverrides } from "../../src/layout/positionedRouting.js";

test("positioned overrides preserve untouched ELK nodes and reroute moved edges", () => {
  const graph = {
    layoutProvider: "elk-layered",
    nodes: [
      { id: "a", kind: "input", label: "a", x: 0, y: 20, width: 92, height: 28, ports: [] },
      { id: "b", kind: "cell", label: "b", x: 220, y: 20, width: 128, height: 72, ports: [], ref: { pins: [] } },
      { id: "y", kind: "output", label: "y", x: 480, y: 20, width: 92, height: 36, ports: [] },
      { id: "c", kind: "input", label: "c", x: 0, y: 320, width: 92, height: 28, ports: [] },
      { id: "z", kind: "output", label: "z", x: 480, y: 320, width: 92, height: 36, ports: [] }
    ],
    edges: [
      { id: "ab", source: "a", target: "b", net: "a" },
      { id: "by", source: "b", target: "y", net: "y" },
      {
        id: "cz",
        source: "c",
        target: "z",
        net: "z",
        routeKind: "elk-orthogonal",
        points: [{ x: 92, y: 334 }, { x: 480, y: 338 }]
      }
    ],
    width: 620,
    height: 180
  };
  const adjusted = applyPositionedOverrides(graph, {
    nodePositions: new Map([["b", { x: 260, y: 180 }]])
  });

  assert.deepEqual(
    { x: adjusted.nodes.find((node) => node.id === "a").x, y: adjusted.nodes.find((node) => node.id === "a").y },
    { x: 0, y: 20 }
  );
  assert.deepEqual(
    { x: adjusted.nodes.find((node) => node.id === "b").x, y: adjusted.nodes.find((node) => node.id === "b").y },
    { x: 260, y: 180 }
  );
  assert.ok(adjusted.edges.filter((edge) => edge.id !== "cz")
    .every((edge) => edge.routeKind === "positioned-override"));
  assert.ok(adjusted.edges.filter((edge) => edge.id !== "cz")
    .every((edge) => typeof edge.routeStrategy === "string"));
  assert.equal(adjusted.edges.find((edge) => edge.id === "cz").routeKind, "elk-orthogonal");
  assert.deepEqual(adjusted.edges.find((edge) => edge.id === "cz").points, graph.edges[2].points);
  assert.ok(adjusted.height > graph.height);
});

test("positioned routing returns the original graph when no overrides exist", () => {
  const graph = { nodes: [], edges: [] };
  assert.equal(applyPositionedOverrides(graph), graph);
});

test("adjust rerouting is invariant to edge array order", () => {
  const graph = {
    nodes: [
      { id: "a", kind: "input", label: "a", x: 0, y: 20, width: 92, height: 28 },
      { id: "b", kind: "input", label: "b", x: 0, y: 180, width: 92, height: 28 },
      { id: "y", kind: "output", label: "y", x: 500, y: 176, width: 92, height: 36 },
      { id: "z", kind: "output", label: "z", x: 500, y: 16, width: 92, height: 36 }
    ],
    edges: [
      { id: "ay", source: "a", target: "y", net: "a", label: "a" },
      { id: "bz", source: "b", target: "z", net: "b", label: "b" }
    ]
  };
  const options = { nodePositions: new Map([["y", { x: 520, y: 176 }], ["z", { x: 520, y: 16 }]]) };

  const forward = applyPositionedOverrides(graph, options);
  const reversed = applyPositionedOverrides({ ...graph, edges: graph.edges.toReversed() }, options);

  assert.deepEqual(normalizeEdges(reversed.edges), normalizeEdges(forward.edges));
});

test("adjust reroutes a net when an unrelated moved cell blocks its old path", () => {
  const graph = {
    nodes: [
      { id: "a", kind: "input", label: "a", x: 0, y: 20, width: 92, height: 28 },
      { id: "y", kind: "output", label: "y", x: 500, y: 16, width: 92, height: 36 },
      { id: "blocker", kind: "cell", label: "blocker", x: 240, y: 180, width: 128, height: 72, ref: { pins: [] } }
    ],
    edges: [{
      id: "ay",
      source: "a",
      target: "y",
      net: "a",
      points: [{ x: 92, y: 34 }, { x: 500, y: 34 }]
    }]
  };
  const adjusted = applyPositionedOverrides(graph, {
    nodePositions: new Map([["blocker", { x: 240, y: 0 }]])
  });
  const edge = adjusted.edges[0];
  const blocker = adjusted.nodes.find((node) => node.id === "blocker");

  assert.equal(edge.routeKind, "positioned-override");
  assert.equal(edge.routeStrategy, "local-detour");
  assert.equal(polylineIntersectsNode(edge.points, blocker), false);
  assert.ok(Math.min(...edge.points.map((point) => point.y)) >= blocker.y - 8);
});

test("adjust uses a nearby obstacle boundary before considering the graph outer lane", () => {
  const graph = {
    nodes: [
      { id: "a", kind: "input", label: "a", x: 20, y: 72, width: 92, height: 28 },
      { id: "y", kind: "output", label: "y", x: 600, y: 68, width: 92, height: 36 },
      { id: "blocker", kind: "cell", label: "blocker", x: 260, y: 180, width: 128, height: 72, ref: { pins: [] } }
    ],
    edges: [{
      id: "ay", source: "a", target: "y", net: "a", label: "a",
      points: [{ x: 112, y: 86 }, { x: 600, y: 86 }]
    }]
  };
  const adjusted = applyPositionedOverrides(graph, {
    nodePositions: new Map([["blocker", { x: 260, y: 50 }]])
  });
  const edge = adjusted.edges[0];

  assert.equal(Math.min(...edge.points.map((point) => point.y)), 42);
  assert.equal(polylineIntersectsNode(edge.points, adjusted.nodes[2]), false);
});

test("adjust routes an input moved right of a cell around to its left input pin", () => {
  const graph = {
    nodes: [
      { id: "a", kind: "input", label: "a", x: 0, y: 20, width: 92, height: 28 },
      {
        id: "u0", kind: "cell", label: "u0", gateKind: "buffer",
        x: 220, y: 20, width: 128, height: 72,
        pinDirections: { A: { direction: "input" }, Z: { direction: "output" } },
        ref: { pins: [{ pin: "A" }, { pin: "Z" }] }
      }
    ],
    edges: [{ id: "au0", source: "a", target: "u0", sourcePin: "a", targetPin: "A", net: "a" }]
  };
  const adjusted = applyPositionedOverrides(graph, {
    nodePositions: new Map([["a", { x: 500, y: 42 }]])
  });
  const edge = adjusted.edges[0];
  const target = adjusted.nodes.find((node) => node.id === "u0");
  const targetPoint = edge.points.at(-1);
  const approachPoint = edge.points.at(-2);

  assert.equal(targetPoint.x, target.x);
  assert.ok(approachPoint.x < targetPoint.x);
  assert.equal(polylineCrossesNodeInterior(edge.points, target), false);
});

test("adjust keeps a short connection local instead of sending it around the graph top", () => {
  const graph = {
    nodes: [
      { id: "a", kind: "input", label: "a", x: 0, y: 20, width: 92, height: 28 },
      {
        id: "u0", kind: "cell", label: "u0", gateKind: "buffer",
        x: 220, y: 100, width: 128, height: 72,
        pinDirections: { A: { direction: "input" }, Z: { direction: "output" } },
        ref: { pins: [{ pin: "A" }, { pin: "Z" }] }
      }
    ],
    edges: [{
      id: "au0", source: "a", target: "u0", sourcePin: "a", targetPin: "A",
      net: "a", label: "a"
    }]
  };
  const adjusted = applyPositionedOverrides(graph, {
    nodePositions: new Map([["u0", { x: 112, y: 100 }]])
  });
  const edge = adjusted.edges[0];
  const endpointYs = [edge.points[0].y, edge.points.at(-1).y];

  assert.ok(edge.points.slice(1, -1).every((point) =>
    point.y >= Math.min(...endpointYs) && point.y <= Math.max(...endpointYs)
  ));
  assert.ok(edge.points.slice(1, -1).every((point) => point.x > 92 && point.x < 112));
});

test("adjust routes a mux select vertically into its top pin", () => {
  const graph = {
    nodes: [
      { id: "c", kind: "input", label: "c", x: 80, y: 20, width: 92, height: 28 },
      {
        id: "mux", kind: "cell", label: "mux", gateKind: "mux",
        x: 260, y: 120, width: 128, height: 108,
        pinDirections: {
          A: { direction: "input", side: "left" },
          B: { direction: "input", side: "left" },
          S: { direction: "input", side: "top", role: "select" },
          Y: { direction: "output", side: "right" }
        },
        ref: { pins: [{ pin: "A" }, { pin: "B" }, { pin: "S" }, { pin: "Y" }] }
      }
    ],
    edges: [{
      id: "c-mux-s", source: "c", target: "mux", sourcePin: "c", targetPin: "S", net: "c"
    }]
  };
  const adjusted = applyPositionedOverrides(graph, {
    nodePositions: new Map([["c", { x: 360, y: 44 }]])
  });
  const edge = adjusted.edges[0];
  const mux = adjusted.nodes.find((node) => node.id === "mux");
  const endpoint = edge.points.at(-1);
  const approach = edge.points.at(-2);

  assert.equal(endpoint.y, mux.y);
  assert.equal(approach.x, endpoint.x);
  assert.ok(approach.y < endpoint.y);
  assert.notEqual(approach.y, endpoint.y);
});

test("adjust places a net label away from a nearby net", () => {
  const graph = {
    nodes: [
      { id: "a", kind: "input", label: "a", x: 0, y: 20, width: 92, height: 28 },
      { id: "y", kind: "output", label: "y", x: 500, y: 16, width: 92, height: 36 }
    ],
    edges: [
      {
        id: "ay", source: "a", target: "y", net: "data", label: "data",
        points: [{ x: 92, y: 34 }, { x: 500, y: 34 }]
      },
      {
        id: "nearby", source: "missing-a", target: "missing-y", net: "nearby", label: "nearby",
        points: [{ x: 180, y: 16 }, { x: 420, y: 16 }]
      }
    ]
  };
  const adjusted = applyPositionedOverrides(graph, {
    nodePositions: new Map([["y", { x: 520, y: 16 }]])
  });
  const edge = adjusted.edges.find((candidate) => candidate.id === "ay");
  const supportingY = edge.points.find((point, index) =>
    index < edge.points.length - 1 && point.y === edge.points[index + 1].y
  ).y;

  assert.equal(edge.showLabel, true);
  assert.equal(edge.labelAnchor, "middle");
  assert.ok(edge.labelPoint.y > supportingY);
});

test("adjust hides a net label when no segment can hold it safely", () => {
  const graph = {
    nodes: [
      { id: "a", kind: "input", label: "a", x: 0, y: 20, width: 92, height: 28 },
      { id: "y", kind: "output", label: "y", x: 120, y: 16, width: 92, height: 36 }
    ],
    edges: [{
      id: "ay", source: "a", target: "y", net: "long", label: "a_very_long_net_name",
      points: [{ x: 92, y: 34 }, { x: 120, y: 34 }]
    }]
  };
  const adjusted = applyPositionedOverrides(graph, {
    nodePositions: new Map([["y", { x: 122, y: 16 }]])
  });

  assert.equal(adjusted.edges[0].showLabel, false);
});

function polylineIntersectsNode(points, node) {
  const padding = 8;
  return points.some((point, index) => index < points.length - 1 &&
    segmentIntersectsBox(point, points[index + 1], {
      left: node.x - padding,
      right: node.x + node.width + padding,
      top: node.y - padding,
      bottom: node.y + node.height + padding
    }));
}

function polylineCrossesNodeInterior(points, node) {
  return points.slice(0, -2).some((point, index) =>
    segmentIntersectsBox(point, points[index + 1], {
      left: node.x,
      right: node.x + node.width,
      top: node.y,
      bottom: node.y + node.height
    }));
}

function segmentIntersectsBox(start, end, box) {
  if (start.y === end.y) {
    return start.y > box.top && start.y < box.bottom &&
      Math.max(start.x, end.x) > box.left && Math.min(start.x, end.x) < box.right;
  }
  if (start.x === end.x) {
    return start.x > box.left && start.x < box.right &&
      Math.max(start.y, end.y) > box.top && Math.min(start.y, end.y) < box.bottom;
  }
  return false;
}

function normalizeEdges(edges) {
  return edges.map((edge) => ({
    id: edge.id,
    points: edge.points,
    labelPoint: edge.labelPoint,
    labelAnchor: edge.labelAnchor,
    showLabel: edge.showLabel
  })).toSorted((left, right) => left.id.localeCompare(right.id));
}
