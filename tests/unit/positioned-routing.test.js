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
  assert.equal(adjusted.edges.find((edge) => edge.id === "cz").routeKind, "elk-orthogonal");
  assert.deepEqual(adjusted.edges.find((edge) => edge.id === "cz").points, graph.edges[2].points);
  assert.ok(adjusted.height > graph.height);
});

test("positioned routing returns the original graph when no overrides exist", () => {
  const graph = { nodes: [], edges: [] };
  assert.equal(applyPositionedOverrides(graph), graph);
});
