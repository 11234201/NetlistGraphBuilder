import assert from "node:assert/strict";
import test from "node:test";
import {
  computeLevelBounds,
  createGlobalLaneYCandidates,
  createBasicSimpleRouteCandidates,
  createLocalObstacleCandidates,
  findObstacleAvoidingRoute,
  MAX_GLOBAL_LANE_CANDIDATES,
  MAX_LOCAL_LANE_CANDIDATES
} from "../../src/layout/simpleRouteCandidates.js";
import { collinearSegmentsOverlap, getRouteSegments } from "../../src/layout/orthogonalRouting.js";
import { createNodeSpatialIndex } from "../../src/layout/spatialIndex.js";

const source = {
  id: "source", kind: "cell", level: 0,
  x: 0, y: 40, width: 80, height: 28
};
const target = {
  id: "target", kind: "cell", level: 1,
  x: 200, y: 40, width: 100, height: 60
};

test("basic Simple candidates keep aligned pins direct", () => {
  const sourcePoint = { x: 80, y: 54 };
  const targetPoint = { x: 200, y: 54 };
  const candidates = createBasicSimpleRouteCandidates({
    source,
    target,
    sourcePoint,
    targetPoint,
    edgePlan: { lane: 0 },
    levelBounds: computeLevelBounds([source, target]),
    wireLanePitch: 18,
    edgeIntent: { fanout: 1, isPrimary: true }
  });

  assert.deepEqual(candidates[0], {
    kind: "direct",
    points: [sourcePoint, targetPoint]
  });
});

test("secondary fanout candidates use their planned source lane", () => {
  const sourcePoint = { x: 80, y: 54 };
  const targetPoint = { x: 200, y: 80 };
  const candidates = createBasicSimpleRouteCandidates({
    source,
    target,
    sourcePoint,
    targetPoint,
    edgePlan: { lane: 2 },
    levelBounds: computeLevelBounds([source, target]),
    wireLanePitch: 18,
    edgeIntent: { fanout: 3, isPrimary: false }
  });
  const trunk = candidates.find((candidate) => candidate.kind === "fanout-trunk");

  assert.equal(trunk.points[1].x, 140);
  assert.equal(trunk.points[2].x, 140);
});

test("local obstacle candidates approach top pins vertically", () => {
  const mux = { ...target, y: 100, height: 80 };
  const sourcePoint = { x: 80, y: 54 };
  const targetPoint = { x: 250, y: 100 };
  const candidates = createLocalObstacleCandidates({
    source,
    target: mux,
    sourcePoint,
    targetPoint,
    nodes: [source, mux]
  });

  assert.ok(candidates.length > 0);
  assert.ok(candidates.length <= MAX_LOCAL_LANE_CANDIDATES);
  for (const candidate of candidates) {
    assert.equal(candidate.points.at(-2).x, targetPoint.x);
    assert.ok(candidate.points.at(-2).y < targetPoint.y);
  }
});

test("global fallback lane candidates stay bounded on large graphs", () => {
  const nodes = Array.from({ length: 5000 }, (_, index) => ({
    id: `n${index}`,
    y: index * 100,
    height: 40
  }));

  const lanes = createGlobalLaneYCandidates(nodes, 20, 48, 16, 24);

  assert.ok(lanes.length <= MAX_GLOBAL_LANE_CANDIDATES);
  assert.equal(lanes[0], 20);
});

test("global fallback reserves vertical lanes used by earlier nets", () => {
  const nodes = [source, target];
  const sourcePoint = { x: 80, y: 54 };
  const targetPoint = { x: 260, y: 100 };
  const first = findObstacleAvoidingRoute({
    source,
    target,
    sourcePoint,
    targetPoint,
    nodes,
    preferredLaneY: 20,
    margin: 48,
    lanePitch: 16,
    nodeIndex: createNodeSpatialIndex(nodes),
    net: "first"
  });
  const reservedSegments = getRouteSegments(first.points, "first").slice(1, 2);
  const second = findObstacleAvoidingRoute({
    source,
    target,
    sourcePoint,
    targetPoint,
    nodes,
    preferredLaneY: 20,
    margin: 48,
    lanePitch: 16,
    nodeIndex: createNodeSpatialIndex(nodes),
    reservedSegments,
    net: "second"
  });

  assert.equal(
    second.points.some((_, index) => index < second.points.length - 1 &&
      reservedSegments.some((reserved) => collinearSegmentsOverlap(
        { start: second.points[index], end: second.points[index + 1] },
        reserved
      ))),
    false
  );
});
