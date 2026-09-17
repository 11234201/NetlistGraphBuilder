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
import {
  collinearSegmentsOverlap,
  getRouteSegments,
  routeFollowsEndpointSides
} from "../../src/layout/orthogonalRouting.js";
import { routeCandidateIsUsable } from "../../src/layout/routeCandidateValidation.js";
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
  assert.equal(trunk.points[0].y, trunk.points[1].y);
  assert.equal(trunk.points.at(-2).y, trunk.points.at(-1).y);
});

test("group channel candidates consume node-local source and target escape lanes", () => {
  const sourceGroup = {
    id: "group:source",
    kind: "group",
    level: 0,
    x: 0,
    y: 40,
    width: 80,
    height: 60,
    ports: [{ pin: "out", direction: "output", side: "right", x: 80, y: 20 }]
  };
  const targetGroup = {
    id: "group:target",
    kind: "group",
    level: 1,
    x: 260,
    y: 80,
    width: 80,
    height: 60,
    ports: [{ pin: "in", direction: "input", side: "left", x: 0, y: 20 }]
  };
  const candidates = createBasicSimpleRouteCandidates({
    source: sourceGroup,
    target: targetGroup,
    sourcePoint: { x: 80, y: 60 },
    targetPoint: { x: 260, y: 100 },
    edgePlan: {
      kind: "channel",
      sourceLane: 1,
      targetLane: 2,
      sourcePin: "out",
      targetPin: "in"
    },
    levelBounds: computeLevelBounds([sourceGroup, targetGroup]),
    wireLanePitch: 18,
    routingGeometry: { portEscapeLength: 24 }
  });
  const boundary = candidates.find((candidate) => candidate.kind === "boundary-channel");

  assert.deepEqual(boundary.points, [
    { x: 80, y: 60 },
    { x: 122, y: 60 },
    { x: 122, y: 100 },
    { x: 260, y: 100 }
  ]);
});

test("group channel candidates stay inside the assigned boundary escape corridor", () => {
  const sourceGroup = {
    id: "group:source",
    kind: "group",
    level: 0,
    x: 0,
    y: 40,
    width: 80,
    height: 60,
    ports: [{ pin: "out", direction: "output", side: "right", x: 80, y: 20 }]
  };
  const targetGroup = {
    id: "group:target",
    kind: "group",
    level: 1,
    x: 260,
    y: 80,
    width: 80,
    height: 60,
    ports: [{ pin: "in", direction: "input", side: "left", x: 0, y: 20 }]
  };
  const candidates = createBasicSimpleRouteCandidates({
    source: sourceGroup,
    target: targetGroup,
    sourcePoint: { x: 80, y: 60 },
    targetPoint: { x: 260, y: 100 },
    edgePlan: {
      kind: "channel",
      sourceLane: 2,
      targetLane: 2,
      sourcePin: "out",
      targetPin: "in",
      capacityCorridor: {
        sourceEscapeInterval: { side: "right", minimum: 88, maximum: 104 },
        targetEscapeRanges: [{ side: "left", minimum: 236, maximum: 252 }]
      }
    },
    levelBounds: computeLevelBounds([sourceGroup, targetGroup]),
    wireLanePitch: 18,
    routingGeometry: { portEscapeLength: 24, groupBoundaryLanePitch: 8 }
  });
  const boundary = candidates.find((candidate) => candidate.kind === "boundary-channel");

  assert.ok(boundary);
  assert.equal(boundary.points[1].x, 104);
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

test("local obstacle candidates leave a visible corner before top pins", () => {
  const mux = { ...target, y: 100, height: 80 };
  const sourcePoint = { x: 240, y: 54 };
  const targetPoint = { x: 250, y: 100 };
  const candidates = createLocalObstacleCandidates({
    source,
    target: mux,
    sourcePoint,
    targetPoint,
    nodes: [source, mux]
  });

  assert.ok(candidates.length > 0);
  assert.ok(candidates.every((candidate) => {
    const corner = candidate.points.at(-3);
    const approach = candidate.points.at(-2);
    const endpoint = candidate.points.at(-1);
    return Math.abs(corner.x - approach.x) >= 16 &&
      approach.x === endpoint.x &&
      approach.y < endpoint.y;
  }));
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

test("global fallback includes bounded capacity lane hints", () => {
  const lanes = createGlobalLaneYCandidates(
    [],
    200,
    48,
    16,
    24,
    null,
    [150, 320, 150]
  );

  assert.ok(lanes.includes(150));
  assert.ok(lanes.includes(320));
  assert.equal(lanes.filter((lane) => lane === 150).length, 1);
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

test("unsatisfiable global fallback reports no candidate instead of returning an unsafe lane", () => {
  const blockedSource = { ...source, y: 40, height: 20 };
  const blockedTarget = { ...target, x: 220, y: 40, height: 20 };
  const blocker = { id: "blocker", kind: "cell", x: 88, y: 0, width: 100, height: 100 };
  const nodes = [blockedSource, blockedTarget, blocker];
  const sourcePoint = { x: 80, y: 50 };
  const targetPoint = { x: 220, y: 50 };
  const route = findObstacleAvoidingRoute({
    source: blockedSource,
    target: blockedTarget,
    sourcePoint,
    targetPoint,
    nodes,
    preferredLaneY: 20,
    margin: 48,
    lanePitch: 16,
    nodeIndex: createNodeSpatialIndex(nodes),
    net: "blocked"
  });

  assert.equal(route, null);
});

test("global lane search keeps source escape on its declared side", () => {
  const sourceHub = {
    id: "hub:source", kind: "hub", level: 2,
    x: 100, y: 100, width: 20, height: 20, ports: []
  };
  const targetCell = {
    id: "cell:target", kind: "cell", level: 3,
    x: 400, y: 0, width: 100, height: 60, ports: []
  };
  const blocker = {
    id: "output:blocker", kind: "output", level: 2,
    x: 120, y: 120, width: 180, height: 80, ports: []
  };
  const sourcePoint = { x: 120, y: 110 };
  const targetPoint = { x: 400, y: 30 };
  const nodes = [sourceHub, targetCell, blocker];
  const nodeIndex = createNodeSpatialIndex(nodes);
  const route = findObstacleAvoidingRoute({
    source: sourceHub,
    target: targetCell,
    sourcePoint,
    targetPoint,
    nodes,
    preferredLaneY: 180,
    margin: 48,
    lanePitch: 16,
    nodeIndex,
    net: "source-net"
  });

  assert.equal(routeFollowsEndpointSides(route.points, sourceHub, targetCell, sourcePoint, targetPoint), true);
  assert.equal(routeCandidateIsUsable(route.points, {
    source: sourceHub,
    target: targetCell,
    sourcePoint,
    targetPoint,
    nodeIndex
  }), true);
  assert.ok(route.points[1].x >= sourcePoint.x);
});
