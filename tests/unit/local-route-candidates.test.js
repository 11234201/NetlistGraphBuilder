import assert from "node:assert/strict";
import test from "node:test";
import { iterateLocalRouteCandidates } from "../../src/layout/localRouteCandidates.js";
import {
  routeLocalOrthogonalEdge,
  selectLocalOrthogonalRoute
} from "../../src/layout/localOrthogonalRouter.js";
import { createNodeSpatialIndex, RouteSegmentIndex } from "../../src/layout/spatialIndex.js";

const source = { id: "source", x: 0, y: 40, width: 80, height: 28 };
const target = { id: "target", x: 200, y: 40, width: 100, height: 60 };

function candidates(overrides = {}) {
  const context = {
    source,
    target,
    start: { x: 80, y: 54 },
    end: { x: 200, y: 54 },
    nodes: [source, target],
    margin: 16,
    ...overrides
  };
  context.nodeIndex = createNodeSpatialIndex(context.nodes);
  return [...iterateLocalRouteCandidates(context)];
}

test("Adjust candidate policy yields a straight connection first", () => {
  const result = candidates();
  assert.deepEqual(result[0], {
    kind: "direct",
    points: [{ x: 80, y: 54 }, { x: 200, y: 54 }]
  });
  assert.ok(result.some((candidate) => candidate.kind === "local-detour"));
  assert.ok(result.some((candidate) => candidate.kind === "outer-lane"));
});

test("Adjust candidates preserve vertical approach to a top pin", () => {
  const mux = { ...target, y: 100, height: 80 };
  const result = candidates({
    target: mux,
    end: { x: 250, y: 100 },
    nodes: [source, mux]
  });

  assert.equal(result[0].kind, "channel");
  assert.equal(result[0].points.at(-2).x, 250);
  assert.ok(result[0].points.at(-2).y < 100);
});

test("reverse-direction connections start with a local detour", () => {
  const rightSource = { ...source, x: 360 };
  const result = candidates({
    source: rightSource,
    start: { x: 440, y: 54 },
    nodes: [rightSource, target]
  });

  assert.equal(result[0].kind, "local-detour");
  assert.deepEqual(result[0].points[0], { x: 440, y: 54 });
  assert.deepEqual(result[0].points.at(-1), { x: 200, y: 54 });
});

test("Adjust scoring chooses a local wire detour over a direct crossing", () => {
  const reservedSegments = new RouteSegmentIndex([{
    start: { x: 140, y: 20 },
    end: { x: 140, y: 80 },
    net: "reserved"
  }]);
  const context = {
    source,
    target,
    start: { x: 80, y: 54 },
    end: { x: 200, y: 54 },
    nodes: [source, target],
    nodeIndex: createNodeSpatialIndex([source, target]),
    margin: 16,
    net: "candidate",
    reservedSegments
  };

  const route = selectLocalOrthogonalRoute(context);
  const points = route.points;

  assert.equal(route.kind, "local-detour");
  assert.ok(points.length > 2);
  assert.ok(points.some((point) => point.y >= 88));
  assert.ok(points.every((point, index) => index === points.length - 1 || !(
    point.y === points[index + 1].y &&
    point.y > 20 && point.y < 80 &&
    Math.min(point.x, points[index + 1].x) < 140 &&
    Math.max(point.x, points[index + 1].x) > 140
  )));
});
