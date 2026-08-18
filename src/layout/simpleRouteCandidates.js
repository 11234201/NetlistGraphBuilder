import {
  compactOrthogonalPoints,
  getTargetApproachPoint
} from "./orthogonalRouting.js";
import {
  routeCandidateIsUsable,
  routeOverlapsReserved,
  routeSegmentIsClear
} from "./routeCandidateValidation.js";
import {
  collectLocalLaneYs,
  queryReservedSegments,
  uniqueRoundedNumbers
} from "./routeLaneCandidates.js";
import { ROUTE_SEARCH_LIMITS } from "./routeSearchPolicy.js";

export const MAX_GLOBAL_LANE_CANDIDATES =
  ROUTE_SEARCH_LIMITS.maximumGlobalLaneCandidates;
export const MAX_LOCAL_LANE_CANDIDATES =
  ROUTE_SEARCH_LIMITS.localChannelAlternatives;

export function createBasicSimpleRouteCandidates(context) {
  const {
    source,
    target,
    sourcePoint,
    targetPoint,
    edgePlan,
    levelBounds,
    wireLanePitch,
    edgeIntent
  } = context;
  const sourceLevel = source.level ?? 0;
  const targetLevel = target.level ?? sourceLevel + 1;
  const levelDistance = targetLevel - sourceLevel;
  const sourceBounds = levelBounds.get(sourceLevel) || { right: source.x + source.width };
  const horizontalGap = targetPoint.x - sourcePoint.x;
  const yDelta = Math.abs(targetPoint.y - sourcePoint.y);
  const candidates = [];

  if (horizontalGap > 0 && yDelta <= 4) {
    candidates.push(createRoute("direct", [sourcePoint, targetPoint]));
  }
  if (Math.abs(horizontalGap) <= 4 && yDelta > 0) {
    candidates.push(createRoute("direct", [sourcePoint, targetPoint]));
  }

  const plannedLane = edgeIntent?.fanout > 1 && !edgeIntent.isPrimary
    ? sourceBounds.right + 24 + (edgePlan?.lane ?? edgePlan?.sourceLane ?? 0) * wireLanePitch
    : null;
  if (plannedLane !== null) {
    candidates.push(createRoute("fanout-trunk", [
      sourcePoint,
      { x: plannedLane, y: sourcePoint.y },
      { x: plannedLane, y: targetPoint.y },
      targetPoint
    ]));
  }

  if (horizontalGap > 0) {
    const inset = Math.min(24, Math.max(2, horizontalGap / 4));
    const minLaneX = sourcePoint.x + inset;
    const maxLaneX = targetPoint.x - inset;
    for (const ratio of [0.5, 0.25, 0.75]) {
      const laneX = minLaneX + (maxLaneX - minLaneX) * ratio;
      candidates.push(createRoute("local-dogleg", [
        sourcePoint,
        { x: laneX, y: sourcePoint.y },
        { x: laneX, y: targetPoint.y },
        targetPoint
      ]));
    }
    if (levelDistance <= 1) {
      const laneX = sourceBounds.right + 18 + (edgePlan?.lane || 0) * wireLanePitch;
      if (laneX > sourcePoint.x && laneX < targetPoint.x) {
        candidates.push(createRoute("channel", [
          sourcePoint,
          { x: laneX, y: sourcePoint.y },
          { x: laneX, y: targetPoint.y },
          targetPoint
        ]));
      }
    }
  }
  return candidates;
}

export function createLocalObstacleCandidates(context) {
  const {
    source,
    target,
    sourcePoint,
    targetPoint,
    nodes,
    nodeIndex,
    nodeBounds,
    levelBounds,
    reservedSegments,
    net
  } = context;
  const padding = 9;
  const routeTargetPoint = getTargetApproachPoint(target, targetPoint, padding);
  const forward = sourcePoint.x < routeTargetPoint.x;
  const gap = Math.abs(routeTargetPoint.x - sourcePoint.x);
  const inset = forward ? Math.min(24, Math.max(2, gap / 4)) : 12;
  const sourceColumnRight = Math.max(
    sourcePoint.x,
    levelBounds?.get(source.level)?.right ?? source.x + source.width
  );
  const targetColumnLeft = Math.min(
    targetPoint.x,
    levelBounds?.get(target.level)?.left ?? target.x
  );
  const sourceUsesLocalEscape = source.kind === "input" ||
    source.kind === "implicit" ||
    source.kind === "constant";
  const sourceLaneX = forward
    ? sourceUsesLocalEscape
      ? Math.min(routeTargetPoint.x - 2, sourcePoint.x + inset)
      : Math.min(routeTargetPoint.x - 2, Math.max(sourcePoint.x + inset, sourceColumnRight + padding))
    : sourcePoint.x + inset;
  const targetLaneX = forward
    ? Math.max(sourcePoint.x + 2, Math.min(routeTargetPoint.x - inset, targetColumnLeft - padding))
    : routeTargetPoint.x - inset;
  const minX = Math.min(sourceLaneX, targetLaneX);
  const maxX = Math.max(sourceLaneX, targetLaneX);
  const corridorTop = Math.min(
    source.y,
    target.y,
    sourcePoint.y,
    routeTargetPoint.y
  ) - padding * 4;
  const corridorBottom = Math.max(
    source.y + source.height,
    target.y + target.height,
    sourcePoint.y,
    routeTargetPoint.y
  ) + padding * 4;
  const relevantNodes = nodeIndex && nodeBounds
    ? nodeIndex.query({
      left: minX - padding,
      right: maxX + padding,
      top: corridorTop,
      bottom: corridorBottom
    })
    : nodes.filter((node) =>
      node.x + node.width + padding > minX && node.x - padding < maxX &&
      node.y + node.height + padding > corridorTop && node.y - padding < corridorBottom);
  const relevantSegments = queryReservedSegments(reservedSegments, {
    left: minX - padding,
    right: maxX + padding,
    top: corridorTop,
    bottom: corridorBottom
  }, net);
  const laneYs = collectLocalLaneYs({
    sourceY: sourcePoint.y,
    targetY: routeTargetPoint.y,
    nodes: relevantNodes,
    segments: relevantSegments,
    padding
  });

  return laneYs.slice(0, MAX_LOCAL_LANE_CANDIDATES).map((laneY) => createRoute("obstacle-local", [
    sourcePoint,
    { x: sourceLaneX, y: sourcePoint.y },
    { x: sourceLaneX, y: laneY },
    { x: targetLaneX, y: laneY },
    { x: targetLaneX, y: routeTargetPoint.y },
    routeTargetPoint,
    targetPoint
  ]));
}

export function findObstacleAvoidingRoute(context) {
  const {
    source,
    target,
    sourcePoint,
    targetPoint,
    nodes,
    preferredLaneY,
    margin,
    lanePitch,
    nodeIndex,
    globalLaneGeometry,
    reservedSegments = [],
    net
  } = context;
  const clearance = 24;
  const routeTargetPoint = getTargetApproachPoint(target, targetPoint, 9);
  const baseSourceLaneX = getEscapeLaneX(source, sourcePoint, "source", clearance);
  const baseTargetLaneX = getEscapeLaneX(target, targetPoint, "target", clearance);
  const yCandidates = createGlobalLaneYCandidates(
    nodes,
    preferredLaneY,
    margin,
    lanePitch,
    clearance,
    globalLaneGeometry
  );
  for (const laneY of yCandidates) {
    const sourceLaneX = findClearVerticalLaneX(
      baseSourceLaneX,
      sourcePoint.y,
      laneY,
      source,
      target,
      nodeIndex,
      reservedSegments,
      net
    );
    const targetLaneX = findClearVerticalLaneX(
      baseTargetLaneX,
      routeTargetPoint.y,
      laneY,
      source,
      target,
      nodeIndex,
      reservedSegments,
      net
    );
    const candidate = createGlobalLaneRoute(
      sourcePoint,
      targetPoint,
      routeTargetPoint,
      sourceLaneX,
      targetLaneX,
      laneY
    );
    if (routeCandidateIsUsable(candidate.points, {
      source,
      target,
      sourcePoint,
      targetPoint,
      nodeIndex
    })) return candidate;
    // A reservation-aware x lane is only a preference until the complete route
    // passes the shared geometry contract. Keep the original node-safe choice
    // available so a dense graph cannot fall through to a node-crossing lane.
    const sourceFallbackLaneX = findClearVerticalLaneX(
      baseSourceLaneX,
      sourcePoint.y,
      laneY,
      source,
      target,
      nodeIndex
    );
    const targetFallbackLaneX = findClearVerticalLaneX(
      baseTargetLaneX,
      routeTargetPoint.y,
      laneY,
      source,
      target,
      nodeIndex
    );
    if (sourceLaneX === sourceFallbackLaneX && targetLaneX === targetFallbackLaneX) continue;
    const fallbackCandidate = createGlobalLaneRoute(
      sourcePoint,
      targetPoint,
      routeTargetPoint,
      sourceFallbackLaneX,
      targetFallbackLaneX,
      laneY
    );
    if (routeCandidateIsUsable(fallbackCandidate.points, {
      source,
      target,
      sourcePoint,
      targetPoint,
      nodeIndex
    })) return fallbackCandidate;
  }

  return createRoute("obstacle-lane", [
    sourcePoint,
    { x: baseSourceLaneX, y: sourcePoint.y },
    { x: baseSourceLaneX, y: yCandidates[0] ?? preferredLaneY },
    { x: baseTargetLaneX, y: yCandidates[0] ?? preferredLaneY },
    { x: baseTargetLaneX, y: routeTargetPoint.y },
    routeTargetPoint,
    targetPoint
  ]);
}

function createGlobalLaneRoute(
  sourcePoint,
  targetPoint,
  routeTargetPoint,
  sourceLaneX,
  targetLaneX,
  laneY
) {
  return createRoute("obstacle-lane", [
    sourcePoint,
    { x: sourceLaneX, y: sourcePoint.y },
    { x: sourceLaneX, y: laneY },
    { x: targetLaneX, y: laneY },
    { x: targetLaneX, y: routeTargetPoint.y },
    routeTargetPoint,
    targetPoint
  ]);
}

export function computeLevelBounds(nodes) {
  const bounds = new Map();
  for (const node of nodes) {
    const level = node.level ?? 0;
    const current = bounds.get(level) || { left: node.x, right: node.x + node.width };
    current.left = Math.min(current.left, node.x);
    current.right = Math.max(current.right, node.x + node.width);
    bounds.set(level, current);
  }
  return bounds;
}

function createRoute(kind, points) {
  return { kind, points: compactOrthogonalPoints(points) };
}

function getEscapeLaneX(node, point, role, clearance) {
  const leftDistance = Math.abs(point.x - node.x);
  const rightDistance = Math.abs(point.x - (node.x + node.width));
  if (role === "source") {
    return rightDistance <= leftDistance ? node.x + node.width + clearance : node.x - clearance;
  }
  return leftDistance <= rightDistance ? node.x - clearance : node.x + node.width + clearance;
}

export function createGlobalLaneYCandidates(
  nodes,
  preferredLaneY,
  margin,
  lanePitch,
  clearance,
  preparedGeometry = null
) {
  const { minTop, maxBottom, gapLanes } = preparedGeometry ||
    prepareGlobalLaneGeometry(nodes, clearance);
  const candidates = [preferredLaneY];
  const outerAttempts = Math.min(
    ROUTE_SEARCH_LIMITS.maximumOuterLaneAttempts,
    Math.max(4, nodes.length)
  );
  for (let index = 0; index < outerAttempts; index += 1) {
    candidates.push(minTop - margin - index * lanePitch);
    candidates.push(maxBottom + margin + index * lanePitch);
  }
  candidates.push(...gapLanes);
  return uniqueRoundedNumbers(candidates).sort(
    (left, right) => Math.abs(left - preferredLaneY) - Math.abs(right - preferredLaneY) ||
      left - right).slice(0, MAX_GLOBAL_LANE_CANDIDATES);
}

export function prepareGlobalLaneGeometry(nodes, clearance) {
  if (!nodes || nodes.length === 0) {
    return { minTop: 0, maxBottom: 0, gapLanes: [] };
  }
  const boxes = nodes.map((node) => ({
    top: node.y - clearance,
    bottom: node.y + node.height + clearance
  })).sort((left, right) => left.top - right.top || left.bottom - right.bottom);
  const gapLanes = [];
  for (let index = 1; index < boxes.length; index += 1) {
    const previous = boxes[index - 1];
    const next = boxes[index];
    if (next.top - previous.bottom >= clearance * 2) {
      gapLanes.push((previous.bottom + next.top) / 2);
    }
  }
  return {
    minTop: boxes[0].top,
    maxBottom: boxes.reduce(
      (maximum, box) => Math.max(maximum, box.bottom),
      boxes[0].bottom
    ),
    gapLanes
  };
}

function findClearVerticalLaneX(
  preferredX,
  y1,
  y2,
  source,
  target,
  nodeIndex,
  reservedSegments = [],
  net
) {
  const offsets = [0, 24, -24, 48, -48, 72, -72, 96, -96, 144, -144, 192, -192];
  let firstClearX = null;
  const hasReservedSegments = reservedSegments && reservedSegments.length > 0;
  for (const offset of offsets) {
    const x = preferredX + offset;
    if (!routeSegmentIsClear(
      { x, y: y1 },
      { x, y: y2 },
      { nodeIndex, source, target }
    )) continue;
    // If every reserved-free alternative is occupied, preserve node clearance
    // as the next-best bounded fallback instead of returning a node-crossing lane.
    firstClearX ??= x;
    if (!hasReservedSegments) return x;
    if (!routeOverlapsReserved([
      { x, y: y1 },
      { x, y: y2 }
    ], net, reservedSegments)) return x;
  }
  return firstClearX ?? preferredX;
}
