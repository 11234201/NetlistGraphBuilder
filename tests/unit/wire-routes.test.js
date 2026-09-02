import assert from "node:assert/strict";
import test from "node:test";
import { buildWireRoutes } from "../../src/layout/wireRoutes.js";
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

test("wire route geometry is invariant to logical edge order", () => {
  assert.deepEqual(buildWireRoutes(fanoutEdges()), buildWireRoutes(fanoutEdges(["b", "a"])));
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
});
