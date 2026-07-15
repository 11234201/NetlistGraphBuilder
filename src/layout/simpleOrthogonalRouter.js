import { compareEdgesByLayoutPriority } from "./layoutIntent.js";
import { getConnectionPoint } from "./nodeGeometry.js";
import {
  compactOrthogonalPoints,
  getRouteSegments,
  getTargetApproachPoint,
  nodeBox,
  orthogonalSegmentIntersectsBox,
  routeFollowsEndpointSides,
  routePreservesEndpointAccess
} from "./orthogonalRouting.js";
import {
  createNodeSpatialIndex,
  RouteSegmentIndex,
  segmentBox
} from "./spatialIndex.js";
import { compareRouteCandidates, scoreRouteCandidate } from "./routeScoring.js";
import { placeWireLabels } from "./wireLabelPlacement.js";

export function routeSimpleEdges(graph, nodes, options) {
  const {
    layoutIntent,
    routePlan,
    wireLanePitch,
    topWireLanePitch,
    margin
  } = options;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const nodeIndex = createNodeSpatialIndex(nodes);
  const levelBounds = computeLevelBounds(nodes);
  const routedById = new Map();
  const reservedSegments = new RouteSegmentIndex();

  for (const edge of graph.edges.toSorted((left, right) =>
    compareEdgesByLayoutPriority(left, right, layoutIntent))) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) continue;
    const sourcePoint = getConnectionPoint(source, edge.sourcePin, "source");
    const targetPoint = getConnectionPoint(target, edge.targetPin, "target");
    const routed = routeEdge({
      source,
      target,
      sourcePoint,
      targetPoint,
      edgePlan: routePlan.edges.get(edge.id),
      levelBounds,
      nodes,
      nodeIndex,
      wireLanePitch,
      topWireLanePitch,
      margin,
      edgeIntent: layoutIntent.getEdge(edge),
      reservedSegments,
      net: edge.net
    });
    const label = getLabelPlacement(edge, source, target, sourcePoint, targetPoint);
    const positionedEdge = {
      ...edge,
      points: routed.points,
      routeKind: routed.kind,
      labelPoint: label.point,
      labelAnchor: label.anchor
    };
    routedById.set(edge.id, positionedEdge);
    reservedSegments.push(...getRouteSegments(positionedEdge.points, edge.net));
  }

  const routedEdges = graph.edges.map((edge) => routedById.get(edge.id) || edge);
  return placeWireLabels(routedEdges, nodes, { preferExisting: true });
}

function routeEdge(context) {
  const {
    source,
    target,
    sourcePoint,
    targetPoint,
    edgePlan,
    levelBounds,
    nodes,
    nodeIndex,
    wireLanePitch,
    topWireLanePitch,
    margin,
    edgeIntent,
    reservedSegments,
    net
  } = context;
  const sourceLevel = source.level ?? 0;
  const targetLevel = target.level ?? sourceLevel + 1;
  const levelDistance = targetLevel - sourceLevel;
  const sourceBounds = levelBounds.get(sourceLevel) || { right: source.x + source.width };
  const horizontalGap = targetPoint.x - sourcePoint.x;
  const yDelta = Math.abs(targetPoint.y - sourcePoint.y);
  const candidates = [];

  if (horizontalGap > 0 && yDelta <= 4) {
    candidates.push(route("direct", [sourcePoint, targetPoint]));
  }
  if (Math.abs(horizontalGap) <= 4 && yDelta > 0) {
    candidates.push(route("direct", [sourcePoint, targetPoint]));
  }

  const plannedLane = edgeIntent?.fanout > 1 && !edgeIntent.isPrimary
    ? sourceBounds.right + 24 + (edgePlan?.lane ?? edgePlan?.sourceLane ?? 0) * wireLanePitch
    : null;
  if (plannedLane !== null) {
    candidates.push(route("fanout-trunk", [
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
      candidates.push(route("local-dogleg", [
        sourcePoint,
        { x: laneX, y: sourcePoint.y },
        { x: laneX, y: targetPoint.y },
        targetPoint
      ]));
    }
    if (levelDistance <= 1) {
      const laneX = sourceBounds.right + 18 + (edgePlan?.lane || 0) * wireLanePitch;
      if (laneX > sourcePoint.x && laneX < targetPoint.x) {
        candidates.push(route("channel", [
          sourcePoint,
          { x: laneX, y: sourcePoint.y },
          { x: laneX, y: targetPoint.y },
          targetPoint
        ]));
      }
    }
  }

  const basicCandidates = candidates.filter((candidate) =>
    isRouteUsable(candidate.points, nodeIndex, source, target, sourcePoint, targetPoint));
  const conflictFreeBasic = basicCandidates.filter((candidate) =>
    scoreRouteCandidate(candidate, { reservedSegments, net, edgeIntent }).crossings === 0);
  if (conflictFreeBasic.length > 0) {
    return chooseBestRoute(conflictFreeBasic, reservedSegments, net, edgeIntent);
  }

  candidates.push(...createLocalObstacleCandidates(
    source,
    target,
    sourcePoint,
    targetPoint,
    nodes
  ));
  const usableCandidates = candidates.filter((candidate) =>
    isRouteUsable(candidate.points, nodeIndex, source, target, sourcePoint, targetPoint));
  if (usableCandidates.length > 0) {
    return chooseBestRoute(usableCandidates, reservedSegments, net, edgeIntent);
  }

  const topLaneY = margin / 2 + (edgePlan?.topLane || 0) * topWireLanePitch;
  return findObstacleAvoidingRoute(
    source,
    target,
    sourcePoint,
    targetPoint,
    nodes,
    topLaneY,
    margin,
    topWireLanePitch,
    nodeIndex
  );
}

function chooseBestRoute(candidates, reservedSegments, net, edgeIntent) {
  return candidates.toSorted((left, right) =>
    compareRouteCandidates(left, right, { reservedSegments, net, edgeIntent }))[0];
}

function createLocalObstacleCandidates(source, target, sourcePoint, targetPoint, nodes) {
  const padding = 9;
  const routeTargetPoint = getTargetApproachPoint(target, targetPoint, padding);
  const forward = sourcePoint.x < routeTargetPoint.x;
  const gap = Math.abs(routeTargetPoint.x - sourcePoint.x);
  const inset = forward ? Math.min(24, Math.max(2, gap / 4)) : 12;
  const sourceColumnRight = Math.max(
    sourcePoint.x,
    ...nodes.filter((node) => node.level === source.level).map((node) => node.x + node.width)
  );
  const targetColumnLeft = Math.min(
    targetPoint.x,
    ...nodes.filter((node) => node.level === target.level).map((node) => node.x)
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
  const relevantNodes = nodes.filter((node) =>
    node.x + node.width + padding > minX && node.x - padding < maxX);
  const laneYs = uniqueRounded([
    sourcePoint.y,
    routeTargetPoint.y,
    (sourcePoint.y + routeTargetPoint.y) / 2,
    ...relevantNodes.flatMap((node) => [node.y - padding, node.y + node.height + padding])
  ]).toSorted((left, right) =>
    localLaneCost(left, sourcePoint.y, routeTargetPoint.y) -
    localLaneCost(right, sourcePoint.y, routeTargetPoint.y));

  return laneYs.map((laneY) => route("obstacle-local", [
    sourcePoint,
    { x: sourceLaneX, y: sourcePoint.y },
    { x: sourceLaneX, y: laneY },
    { x: targetLaneX, y: laneY },
    { x: targetLaneX, y: routeTargetPoint.y },
    routeTargetPoint,
    targetPoint
  ]));
}

function localLaneCost(laneY, sourceY, targetY) {
  return Math.abs(laneY - sourceY) + Math.abs(laneY - targetY);
}

function route(kind, points) {
  return { kind, points: compactOrthogonalPoints(points) };
}

function isRouteUsable(points, nodeIndex, source, target, sourcePoint, targetPoint) {
  return isRouteClear(points, nodeIndex, source, target) &&
    routeFollowsEndpointSides(points, source, target, sourcePoint, targetPoint) &&
    routePreservesEndpointAccess(points, source, target);
}

function findObstacleAvoidingRoute(
  source,
  target,
  sourcePoint,
  targetPoint,
  nodes,
  preferredLaneY,
  margin,
  lanePitch,
  nodeIndex
) {
  const clearance = 24;
  const routeTargetPoint = getTargetApproachPoint(target, targetPoint, 9);
  const baseSourceLaneX = getEscapeLaneX(source, sourcePoint, "source", clearance);
  const targetUsesVerticalApproach = routeTargetPoint !== targetPoint;
  const baseTargetLaneX = targetUsesVerticalApproach
    ? routeTargetPoint.x
    : getEscapeLaneX(target, targetPoint, "target", clearance);
  const yCandidates = getGlobalLaneYCandidates(nodes, preferredLaneY, margin, lanePitch, clearance);

  for (const laneY of yCandidates) {
    const sourceLaneX = findClearVerticalLaneX(
      baseSourceLaneX,
      sourcePoint.y,
      laneY,
      source,
      target,
      nodeIndex
    );
    const targetLaneX = targetUsesVerticalApproach
      ? baseTargetLaneX
      : findClearVerticalLaneX(
        baseTargetLaneX,
        routeTargetPoint.y,
        laneY,
        source,
        target,
        nodeIndex
      );
    const candidate = route("obstacle-lane", [
      sourcePoint,
      { x: sourceLaneX, y: sourcePoint.y },
      { x: sourceLaneX, y: laneY },
      { x: targetLaneX, y: laneY },
      { x: targetLaneX, y: routeTargetPoint.y },
      routeTargetPoint,
      targetPoint
    ]);
    if (isRouteUsable(candidate.points, nodeIndex, source, target, sourcePoint, targetPoint)) {
      return candidate;
    }
  }

  return route("obstacle-lane", [
    sourcePoint,
    { x: baseSourceLaneX, y: sourcePoint.y },
    { x: baseSourceLaneX, y: yCandidates[0] ?? preferredLaneY },
    { x: baseTargetLaneX, y: yCandidates[0] ?? preferredLaneY },
    { x: baseTargetLaneX, y: routeTargetPoint.y },
    routeTargetPoint,
    targetPoint
  ]);
}

function getEscapeLaneX(node, point, role, clearance) {
  const leftDistance = Math.abs(point.x - node.x);
  const rightDistance = Math.abs(point.x - (node.x + node.width));
  if (role === "source") {
    return rightDistance <= leftDistance ? node.x + node.width + clearance : node.x - clearance;
  }
  return leftDistance <= rightDistance ? node.x - clearance : node.x + node.width + clearance;
}

function getGlobalLaneYCandidates(nodes, preferredLaneY, margin, lanePitch, clearance) {
  const boxes = nodes.map((node) => ({
    top: node.y - clearance,
    bottom: node.y + node.height + clearance
  }));
  const minTop = Math.min(...boxes.map((box) => box.top));
  const maxBottom = Math.max(...boxes.map((box) => box.bottom));
  const candidates = [preferredLaneY];

  for (let index = 0; index < Math.max(4, nodes.length); index += 1) {
    candidates.push(minTop - margin - index * lanePitch);
    candidates.push(maxBottom + margin + index * lanePitch);
  }
  const sortedBoxes = boxes.toSorted((left, right) => left.top - right.top);
  for (let index = 1; index < sortedBoxes.length; index += 1) {
    const previous = sortedBoxes[index - 1];
    const next = sortedBoxes[index];
    if (next.top - previous.bottom >= clearance * 2) {
      candidates.push((previous.bottom + next.top) / 2);
    }
  }
  return uniqueRounded(candidates).sort(
    (left, right) => Math.abs(left - preferredLaneY) - Math.abs(right - preferredLaneY));
}

function findClearVerticalLaneX(preferredX, y1, y2, source, target, nodeIndex) {
  const offsets = [0, 24, -24, 48, -48, 72, -72, 96, -96, 144, -144, 192, -192];
  for (const offset of offsets) {
    const x = preferredX + offset;
    if (!segmentHitsObstacle({ x, y: y1 }, { x, y: y2 }, nodeIndex, source, target)) return x;
  }
  return preferredX;
}

function isRouteClear(points, nodeIndex, source, target) {
  return points.every((point, index) => index === points.length - 1 ||
    !segmentHitsObstacle(point, points[index + 1], nodeIndex, source, target));
}

function segmentHitsObstacle(start, end, nodeIndex, source, target) {
  const padding = 8;
  const segment = { start, end };
  return nodeIndex.query(segmentBox(segment, padding)).some((node) =>
    node.id !== source.id &&
    node.id !== target.id &&
    orthogonalSegmentIntersectsBox(start, end, nodeBox(node, padding)));
}

function uniqueRounded(values) {
  return [...new Set(values.map((value) => Math.round(value * 1000) / 1000))];
}

function getLabelPlacement(edge, source, target, sourcePoint, targetPoint) {
  const labelWidth = Math.min(96, Math.max(28, String(edge.label || "").length * 6));
  if (target.kind === "cell" || target.kind === "assign" || target.kind === "output") {
    return {
      point: { x: targetPoint.x - labelWidth - 8, y: targetPoint.y - 6 },
      anchor: "start"
    };
  }
  return { point: { x: sourcePoint.x + 8, y: sourcePoint.y - 6 }, anchor: "start" };
}

function computeLevelBounds(nodes) {
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
