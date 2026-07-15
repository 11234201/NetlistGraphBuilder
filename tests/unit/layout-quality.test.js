import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeLayoutQuality,
  compareLayoutQuality
} from "../../src/layout/layoutQuality.js";

test("layout quality summarizes bends, detours, crossings and overlaps", () => {
  const graph = {
    nodes: [],
    edges: [
      {
        id: "a", net: "a", routeKind: "direct", label: "a",
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }]
      },
      {
        id: "b", net: "b", routeKind: "direct", label: "b",
        points: [{ x: 50, y: -50 }, { x: 50, y: 50 }]
      },
      {
        id: "c", net: "c", routeKind: "detour", routeStrategy: "local-detour",
        label: "c", showLabel: false,
        points: [
          { x: 20, y: 0 },
          { x: 20, y: 20 },
          { x: 80, y: 20 },
          { x: 80, y: 0 }
        ]
      },
      {
        id: "d", net: "d", routeKind: "positioned-override", routeStrategy: "outer-lane",
        label: "d",
        points: [
          { x: 0, y: 200 },
          { x: 0, y: 220 },
          { x: 100, y: 220 },
          { x: 100, y: 200 }
        ]
      }
    ]
  };
  const quality = analyzeLayoutQuality(graph);

  assert.equal(quality.directRouteCount, 2);
  assert.equal(quality.totalBends, 4);
  assert.equal(quality.crossingCount, 2);
  assert.equal(quality.overlapCount, 0);
  assert.equal(quality.hiddenLabelCount, 1);
  assert.equal(quality.routeKinds.direct, 2);
  assert.equal(quality.routeStrategies["local-detour"], 1);
  assert.equal(quality.outerRouteCount, 1);
  assert.equal(quality.outerRouteRatio, 0.25);
});

test("layout quality comparison exposes stable signed deltas", () => {
  const base = {
    nodes: [],
    edges: [{
      id: "a", net: "a", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }]
    }]
  };
  const candidate = structuredClone(base);
  candidate.edges[0].points = [
    { x: 0, y: 0 },
    { x: 0, y: 20 },
    { x: 100, y: 20 },
    { x: 100, y: 0 }
  ];
  const comparison = compareLayoutQuality(base, candidate);

  assert.equal(comparison.delta.totalLength, 40);
  assert.equal(comparison.delta.totalBends, 2);
  assert.equal(comparison.delta.directRouteRatio, -1);
  assert.equal(comparison.delta.averageDetourRatio, 0.4);
});
