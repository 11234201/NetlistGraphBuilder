import assert from "node:assert/strict";
import test from "node:test";
import { buildWireRoutes } from "../../src/layout/wireRoutes.js";
import { buildNetTreeSegments } from "../../src/layout/netTreeRouter.js";
import { validateLayoutGraph } from "../../src/layout/layoutValidator.js";
import { analyzeLayoutQuality } from "../../src/layout/layoutQuality.js";
import { renderSchematicSvg } from "../../src/render/svgRenderer.js";

function fanoutEdges(order = ["a", "b"]) {
  const byId = {
    a: {
      id: "edge-a",
      source: "driver",
      target: "sink-a",
      net: "shared",
      label: "shared",
      points: [{ x: 20, y: 40 }, { x: 120, y: 40 }, { x: 120, y: 80 }],
      labelPoint: { x: 70, y: 34 },
      labelAnchor: "middle"
    },
    b: {
      id: "edge-b",
      source: "driver",
      target: "sink-b",
      net: "shared",
      label: "shared",
      points: [{ x: 20, y: 40 }, { x: 120, y: 40 }, { x: 120, y: 120 }],
      labelPoint: { x: 90, y: 114 },
      labelAnchor: "middle"
    }
  };
  return order.map((id) => byId[id]);
}

test("wire routes union shared fanout trunks while preserving logical ownership", () => {
  const [route] = buildWireRoutes(fanoutEdges());
  assert.equal(route.netGroupKey, "driver\u0000shared");
  assert.equal(route.topology, "tree");
  assert.equal(route.treeFallback, false);
  assert.deepEqual(route.logicalEdgeIds, ["edge-a", "edge-b"]);
  assert.equal(route.segments.length, 3);
  assert.deepEqual(route.segments[0].start, { x: 20, y: 40 });
  assert.deepEqual(route.segments[0].end, { x: 120, y: 40 });
  assert.deepEqual(route.segments[0].logicalEdgeIds, ["edge-a", "edge-b"]);
  assert.deepEqual(route.segments[1].start, { x: 120, y: 40 });
  assert.deepEqual(route.segments[1].end, { x: 120, y: 80 });
  assert.deepEqual(route.segments[1].logicalEdgeIds, ["edge-a", "edge-b"]);
  assert.deepEqual(route.segments[2].start, { x: 120, y: 80 });
  assert.deepEqual(route.segments[2].end, { x: 120, y: 120 });
  assert.deepEqual(route.segments[2].logicalEdgeIds, ["edge-b"]);
  assert.deepEqual(route.junctions, [{ x: 120, y: 80 }]);
});

test("net tree selection removes a provider cycle while retaining every target path", () => {
  const segments = [
    { start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, logicalEdgeIds: ["a"] },
    { start: { x: 10, y: 0 }, end: { x: 10, y: 10 }, logicalEdgeIds: ["b"] },
    { start: { x: 10, y: 10 }, end: { x: 0, y: 10 }, logicalEdgeIds: ["b"] },
    { start: { x: 0, y: 10 }, end: { x: 0, y: 0 }, logicalEdgeIds: ["a"] }
  ];
  const tree = buildNetTreeSegments(segments, [
    { id: "a", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
    { id: "b", points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }
  ]);

  assert.equal(tree.topology, "tree");
  assert.equal(tree.treeFallback, false);
  assert.equal(tree.cycleCount, 0);
  assert.equal(tree.segments.length, 3);
  assert.deepEqual(tree.segments.flatMap((segment) => segment.logicalEdgeIds).toSorted(), ["a", "b", "b"]);
});

test("net tree selection keeps disconnected provider geometry as a marked fallback", () => {
  const tree = buildNetTreeSegments([
    { start: { x: 0, y: 0 }, end: { x: 5, y: 0 }, logicalEdgeIds: ["a"] },
    { start: { x: 8, y: 0 }, end: { x: 10, y: 0 }, logicalEdgeIds: ["a"] }
  ], [{ id: "a", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }]);

  assert.equal(tree.topology, "forest");
  assert.equal(tree.treeFallback, true);
  assert.equal(tree.reachableTargetCount, 0);
  assert.equal(tree.segments.length, 2);
});

test("wire route geometry is invariant to logical edge order", () => {
  assert.deepEqual(buildWireRoutes(fanoutEdges()), buildWireRoutes(fanoutEdges(["b", "a"])));
});

test("junction markers follow the selected physical tree", () => {
  const [route] = buildWireRoutes([
    {
      id: "edge-a",
      source: "driver",
      target: "sink-a",
      net: "shared",
      label: "shared",
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]
    },
    {
      id: "edge-b",
      source: "driver",
      target: "sink-b",
      net: "shared",
      label: "shared",
      points: [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }]
    }
  ]);

  assert.deepEqual(route.junctions, []);
});

test("same-named nets with different drivers remain separate physical routes", () => {
  const edges = fanoutEdges();
  edges[1] = { ...edges[1], source: "other-driver" };
  const routes = buildWireRoutes(edges);
  assert.equal(routes.length, 2);
  assert.deepEqual(routes.map((route) => route.sourceNodeId), ["driver", "other-driver"]);
});

test("renderer paints a merged route once and keeps logical edge hit metadata", () => {
  const [route] = buildWireRoutes(fanoutEdges());
  const svg = renderSchematicSvg({
    moduleDisplayName: "wire-routes",
    width: 200,
    height: 180,
    nodes: [],
    edges: fanoutEdges(),
    wireRoutes: [route]
  });
  assert.equal((svg.match(/class="wire"/g) || []).length, 3);
  assert.match(svg, /data-edge-ids="edge-a,edge-b"/);
  assert.equal((svg.match(/class="wire-label"/g) || []).length, 1);
  assert.equal((svg.match(/class="wire-junction"/g) || []).length, 1);
});

test("layout validation accepts normalized unique physical segments", () => {
  const edges = fanoutEdges();
  const [route] = buildWireRoutes(edges);
  const violations = validateLayoutGraph({ nodes: [], edges: [], wireRoutes: [route] }, {
    checkObstacles: false,
    checkOverlaps: false
  });
  assert.deepEqual(violations, []);
});

test("layout validation rejects a physical route that crosses a node body", () => {
  const [route] = buildWireRoutes([{
    id: "edge-crossing",
    source: "input:a",
    target: "output:y",
    net: "a",
    label: "a",
    points: [{ x: 20, y: 50 }, { x: 180, y: 50 }]
  }]);
  const violations = validateLayoutGraph({
    nodes: [{ id: "cell:blocker", kind: "cell", x: 80, y: 20, width: 40, height: 60 }],
    edges: [],
    wireRoutes: [route]
  }, { checkOverlaps: false });

  assert.deepEqual(violations.map((violation) => violation.code), ["wire-route-node-crossing"]);
  assert.equal(violations[0].nodeId, "cell:blocker");
});

test("physical route validation allows a segment that terminates at a node boundary", () => {
  const [route] = buildWireRoutes([{
    id: "edge-terminal",
    source: "input:a",
    target: "cell:u0",
    net: "a",
    label: "a",
    points: [{ x: 20, y: 50 }, { x: 80, y: 50 }]
  }]);
  const violations = validateLayoutGraph({
    nodes: [{ id: "cell:u0", kind: "cell", x: 80, y: 20, width: 40, height: 60 }],
    edges: [],
    wireRoutes: [route]
  }, { checkOverlaps: false });

  assert.deepEqual(violations, []);
});

test("layout quality reports logical fanout duplication removed from rendered geometry", () => {
  const edges = fanoutEdges();
  const wireRoutes = buildWireRoutes(edges);
  const quality = analyzeLayoutQuality({ nodes: [], edges, wireRoutes });
  assert.equal(quality.logicalWireLength, 320);
  assert.equal(quality.uniqueWireLength, 180);
  assert.equal(quality.eliminatedDuplicateLength, 140);
  assert.equal(quality.renderedDuplicateLength, 0);
  assert.equal(quality.wireSegmentCount, 3);
  assert.equal(quality.junctionCount, 1);
  assert.equal(quality.treeRouteCount, 1);
  assert.equal(quality.forestRouteCount, 0);
  assert.equal(quality.treeFallbackCount, 0);
  assert.equal(quality.cycleCount, 0);
});
