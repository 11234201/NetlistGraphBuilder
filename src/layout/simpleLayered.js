import { DEFAULT_LAYOUT_POLICY, normalizeLayoutPolicy } from "./layoutPolicy.js";
import { analyzeLayoutIntent, compareEdgesByLayoutPriority } from "./layoutIntent.js";
import {
  buildNodePorts,
  computeBounds,
  DEFAULT_CELL_PIN_PITCH,
  getConnectionPoint,
  measureNode
} from "./nodeGeometry.js";
import {
  alignDrivenTargetsToDriverPins,
  alignSingleConnectionEndpoints,
  applyBranchAwareLanes,
  applyFanoutHubLocality,
  applyNodePositionOverrides,
  applyNodeSizeOverride,
  applySingleFanoutInputLocality,
  compareNodes,
  computeLevelXs,
  resolveLevelOverlaps,
  resolveExternalSourceOverlaps,
  resolveOutputOverlaps
} from "./nodePlacement.js";

export const DEFAULT_WIRE_LANE_PITCH = 18;
export const DEFAULT_TOP_WIRE_LANE_PITCH = 16;
export { DEFAULT_LAYOUT_POLICY };
export {
  DEFAULT_CELL_PIN_PITCH,
  DEFAULT_INPUT_NODE_HEIGHT,
  DEFAULT_PIN_NODE_HEIGHT
} from "./nodeGeometry.js";

export function layoutGraph(graph, options = {}) {
  const policy = normalizeLayoutPolicy(options.layoutPolicy, options);
  const ySpacing = policy.spacing.y;
  const margin = policy.spacing.margin;
  const cellPinPitch = clamp(Number(policy.spacing.cellPinPitch) || DEFAULT_CELL_PIN_PITCH, 18, 72);
  const wireLanePitch = clamp(
    Number(policy.spacing.wireLanePitch) || DEFAULT_WIRE_LANE_PITCH,
    8,
    48
  );
  const topWireLanePitch = clamp(
    Number(options.topWireLanePitch) || Math.max(8, wireLanePitch - 2),
    8,
    48
  );
  const levels = assignLevels(graph);
  const layoutIntent = analyzeLayoutIntent(graph, levels);
  const routePlan = planRouting(graph, levels, layoutIntent);
  const xSpacing = Number(policy.spacing.x) || 260;
  const topWireSpace = options.topWireSpace || 80;
  const buckets = new Map();

  for (const node of graph.nodes) {
    const level = levels.get(node.id) || 0;
    if (!buckets.has(level)) {
      buckets.set(level, []);
    }
    buckets.get(level).push(node);
  }

  const positionedNodes = [];
  const levelKeys = [...buckets.keys()].sort((a, b) => a - b);
  orderBucketsByTopology(buckets, levelKeys, graph.edges);
  const nodeSizes = new Map(
    graph.nodes.map((node) => [
      node.id,
      applyNodeSizeOverride(measureNode(node, cellPinPitch), options.nodeSizes, node.id)
    ])
  );
  const levelXs = computeLevelXs(
    graph,
    levels,
    buckets,
    levelKeys,
    nodeSizes,
    xSpacing,
    margin,
    policy.features.localizeSingleFanoutInputs,
    layoutIntent,
    policy.spacing
  );

  for (const level of levelKeys) {
    const nodes = buckets.get(level);
    let nextY = topWireSpace + margin;
    for (const [index, node] of nodes.entries()) {
      const size = nodeSizes.get(node.id);
      positionedNodes.push({
        ...node,
        x: levelXs.get(level),
        y: nextY,
        level,
        width: size.width,
        height: size.height,
        ports: buildNodePorts(node, size, cellPinPitch)
      });
      const nodeGap = layoutIntent.getNodeFanout(node) > 1
        ? Number(policy.spacing.fanoutYGap) || 28
        : Number(policy.spacing.compactYGap) || 8;
      nextY += Math.min(ySpacing, size.height + nodeGap);
    }
  }

  if (policy.features.branchAwareLanes) {
    applyBranchAwareLanes(
      positionedNodes,
      graph.edges,
      levelKeys,
      policy.spacing.branchTopY,
      policy.spacing.branchLanePitch
    );
  }
  if (policy.features.alignDrivenLinks) {
    alignDrivenTargetsToDriverPins(positionedNodes, graph.edges, levelKeys, layoutIntent, margin);
  }
  resolveLevelOverlaps(
    positionedNodes,
    levelKeys,
    margin,
    Number(policy.spacing.compactYGap) || 8,
    layoutIntent,
    Number(policy.spacing.fanoutYGap) || 28
  );
  alignSingleConnectionEndpoints(positionedNodes, graph.edges, layoutIntent);
  resolveExternalSourceOverlaps(
    positionedNodes,
    margin,
    Number(policy.spacing.compactYGap) || 8
  );
  applyFanoutHubLocality(positionedNodes, graph.edges, margin);
  if (policy.features.localizeSingleFanoutInputs) {
    applySingleFanoutInputLocality(
      positionedNodes,
      graph.edges,
      margin,
      layoutIntent,
      topWireLanePitch
    );
  }
  resolveOutputOverlaps(positionedNodes, margin);
  applyNodePositionOverrides(positionedNodes, options.nodePositions);

  const nodeById = new Map(positionedNodes.map((node) => [node.id, node]));
  const levelBounds = computeLevelBounds(positionedNodes);
  const routedById = new Map();
  const reservedSegments = [];
  for (const edge of graph.edges.toSorted((left, right) =>
    compareEdgesByLayoutPriority(left, right, layoutIntent))) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    const sourcePoint = getConnectionPoint(source, edge.sourcePin, "source");
    const targetPoint = getConnectionPoint(target, edge.targetPin, "target");
    const route = routeEdge(
      source,
      target,
      sourcePoint,
      targetPoint,
      routePlan.edges.get(edge.id),
      levelBounds,
      positionedNodes,
      wireLanePitch,
      topWireLanePitch,
      margin,
      layoutIntent.getEdge(edge),
      reservedSegments,
      edge.net
    );
    const label = getLabelPlacement(edge, source, target, sourcePoint, targetPoint);

    const positionedEdge = {
      ...edge,
      points: route.points,
      routeKind: route.kind,
      labelPoint: label.point,
      labelAnchor: label.anchor
    };
    routedById.set(edge.id, positionedEdge);
    reservedSegments.push(...getRouteSegments(positionedEdge.points, edge.net));
  }
  const positionedEdges = graph.edges.map((edge) => routedById.get(edge.id));

  const bounds = computeBounds(positionedNodes);

  return {
    ...graph,
    nodes: positionedNodes,
    edges: positionedEdges,
    width: bounds.width + margin,
    height: bounds.height + margin
  };
}

function planRouting(graph, levels, layoutIntent) {
  const edges = new Map();
  const channelLanes = new Map();
  const channelLaneByFanout = new Map();
  const fanoutCounts = new Map();
  for (const edge of graph.edges) {
    const key = `${edge.source}\u0000${edge.net}`;
    fanoutCounts.set(key, (fanoutCounts.get(key) || 0) + 1);
  }
  const longSourceLanes = new Map();
  const longSourceLaneByFanout = new Map();
  const longTargetLanes = new Map();
  let longLaneCount = 0;
  let maxSideLanes = 1;

  for (const edge of graph.edges) {
    const sourceLevel = levels.get(edge.source) || 0;
    const targetLevel = levels.get(edge.target) || sourceLevel + 1;
    const levelDistance = targetLevel - sourceLevel;

    if (levelDistance <= 1) {
      const key = `${sourceLevel}->${targetLevel}`;
      const fanoutKey = `${edge.source}\u0000${edge.net}`;
      let lane = channelLaneByFanout.get(fanoutKey);
      if (lane === undefined || fanoutCounts.get(fanoutKey) === 1) {
        lane = channelLanes.get(key) || 0;
        channelLanes.set(key, lane + 1);
        if (fanoutCounts.get(fanoutKey) > 1) channelLaneByFanout.set(fanoutKey, lane);
      }
      maxSideLanes = Math.max(maxSideLanes, lane + 1);
      edges.set(edge.id, { kind: "channel", lane });
      continue;
    }

    const sourceKey = `source:${sourceLevel}`;
    const targetKey = `target:${targetLevel}`;
    const intent = layoutIntent.getEdge(edge);
    let sourceLane = intent?.fanout > 1
      ? longSourceLaneByFanout.get(intent.groupKey)
      : undefined;
    if (sourceLane === undefined) {
      sourceLane = longSourceLanes.get(sourceKey) || 0;
      if (intent?.fanout > 1) longSourceLaneByFanout.set(intent.groupKey, sourceLane);
    }
    const targetLane = longTargetLanes.get(targetKey) || 0;
    longSourceLanes.set(sourceKey, Math.max(longSourceLanes.get(sourceKey) || 0, sourceLane + 1));
    longTargetLanes.set(targetKey, targetLane + 1);
    maxSideLanes = Math.max(maxSideLanes, sourceLane + 1, targetLane + 1);
    edges.set(edge.id, {
      kind: "long",
      topLane: longLaneCount,
      sourceLane,
      targetLane
    });
    longLaneCount += 1;
  }

  return {
    edges,
    longLaneCount,
    maxSideLanes
  };
}

function routeEdge(
  source,
  target,
  sourcePoint,
  targetPoint,
  edgePlan,
  levelBounds,
  nodes,
  wireLanePitch,
  topWireLanePitch,
  margin,
  edgeIntent,
  reservedSegments,
  net
) {
  const sourceLevel = source.level ?? 0;
  const targetLevel = target.level ?? sourceLevel + 1;
  const levelDistance = targetLevel - sourceLevel;
  const sourceBounds = levelBounds.get(sourceLevel) || { right: source.x + source.width };
  const targetBounds = levelBounds.get(targetLevel) || { left: target.x };
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
    isRouteUsable(candidate.points, nodes, source, target, sourcePoint, targetPoint)
  );
  const conflictFreeBasic = basicCandidates.filter((candidate) =>
    countRouteConflicts(candidate.points, reservedSegments, net) === 0
  );
  if (conflictFreeBasic.length > 0) {
    return conflictFreeBasic.toSorted((left, right) =>
      scoreRoute(left, reservedSegments, net, edgeIntent) -
      scoreRoute(right, reservedSegments, net, edgeIntent)
    )[0];
  }

  candidates.push(...createLocalObstacleCandidates(source, target, sourcePoint, targetPoint, nodes));
  const usableCandidates = candidates.filter((candidate) =>
    isRouteUsable(candidate.points, nodes, source, target, sourcePoint, targetPoint)
  );
  if (usableCandidates.length > 0) {
    return usableCandidates.toSorted((left, right) =>
      scoreRoute(left, reservedSegments, net, edgeIntent) -
      scoreRoute(right, reservedSegments, net, edgeIntent)
    )[0];
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
    topWireLanePitch
  );
}

function createLocalObstacleCandidates(source, target, sourcePoint, targetPoint, nodes) {
  const padding = 9;
  const routeTargetPoint = getTargetApproachPoint(target, targetPoint);
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
    node.x + node.width + padding > minX && node.x - padding < maxX
  );
  const laneYs = uniqueRounded([
    sourcePoint.y,
    routeTargetPoint.y,
    (sourcePoint.y + routeTargetPoint.y) / 2,
    ...relevantNodes.flatMap((node) => [node.y - padding, node.y + node.height + padding])
  ]).toSorted((left, right) =>
    localLaneCost(left, sourcePoint.y, routeTargetPoint.y) -
    localLaneCost(right, sourcePoint.y, routeTargetPoint.y)
  );
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

function scoreRoute(candidate, reservedSegments, net, edgeIntent) {
  const crossings = countRouteConflicts(candidate.points, reservedSegments, net);
  const length = getRouteLength(candidate.points);
  const bends = Math.max(0, candidate.points.length - 2);
  const bendWeight = edgeIntent?.fanout > 1 && !edgeIntent.isPrimary ? 40 : 120;
  return crossings * 100000 + bends * bendWeight + length;
}

function getRouteLength(points) {
  let length = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    length += Math.abs(points[index + 1].x - points[index].x) +
      Math.abs(points[index + 1].y - points[index].y);
  }
  return length;
}

function route(kind, points) {
  return {
    kind,
    points: compactPoints(points)
  };
}

function isRouteUsable(points, nodes, source, target, sourcePoint, targetPoint) {
  return (
    isRouteClear(points, nodes, source, target) &&
    exitsSourceWithoutCrossingBody(points, source, sourcePoint) &&
    entersTargetWithoutCrossingBody(points, target, targetPoint) &&
    entersTargetFromPortSide(points, target, targetPoint) &&
    preservesEndpointAccess(points, source, target)
  );
}

function getTargetApproachPoint(target, targetPoint) {
  const clearance = 9;
  if (near(targetPoint.y, target.y) && inside(targetPoint.x, target.x, target.x + target.width)) {
    return { x: targetPoint.x, y: target.y - clearance };
  }
  if (
    near(targetPoint.y, target.y + target.height) &&
    inside(targetPoint.x, target.x, target.x + target.width)
  ) {
    return { x: targetPoint.x, y: target.y + target.height + clearance };
  }
  return targetPoint;
}

function entersTargetFromPortSide(points, target, targetPoint) {
  if (points.length < 2) return false;
  const previous = points.at(-2);
  const onTopOrBottom = (
    near(targetPoint.y, target.y) || near(targetPoint.y, target.y + target.height)
  ) && inside(targetPoint.x, target.x, target.x + target.width);
  if (onTopOrBottom) {
    return near(previous.x, targetPoint.x) && !near(previous.y, targetPoint.y);
  }

  const onLeftOrRight = (
    near(targetPoint.x, target.x) || near(targetPoint.x, target.x + target.width)
  ) && inside(targetPoint.y, target.y, target.y + target.height);
  if (onLeftOrRight) {
    return near(previous.y, targetPoint.y) && !near(previous.x, targetPoint.x);
  }
  return true;
}

function near(left, right) {
  return Math.abs(left - right) < 0.5;
}

function inside(value, minimum, maximum) {
  return value > minimum + 0.5 && value < maximum - 0.5;
}

function preservesEndpointAccess(points, source, target) {
  const sourceBox = nodeBox(source);
  const targetBox = nodeBox(target);
  const lastSegment = points.length - 2;
  for (let index = 0; index < points.length - 1; index += 1) {
    if (index !== 0 && segmentIntersectsNodeBox(points[index], points[index + 1], sourceBox)) {
      return false;
    }
    if (index !== lastSegment && segmentIntersectsNodeBox(points[index], points[index + 1], targetBox)) {
      return false;
    }
  }
  return true;
}

function nodeBox(node) {
  return {
    left: node.x,
    right: node.x + node.width,
    top: node.y,
    bottom: node.y + node.height
  };
}

function segmentIntersectsNodeBox(start, end, box) {
  if (start.y === end.y) return horizontalSegmentIntersectsBox(start, end, box);
  if (start.x === end.x) return verticalSegmentIntersectsBox(start, end, box);
  return true;
}

function getRouteSegments(points, net) {
  const segments = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    segments.push({ start: points[index], end: points[index + 1], net });
  }
  return segments;
}

function countRouteConflicts(points, reservedSegments, net) {
  let conflicts = 0;
  for (const segment of getRouteSegments(points, net)) {
    for (const reserved of reservedSegments) {
      if (reserved.net !== net && segmentsConflict(segment, reserved)) conflicts += 1;
    }
  }
  return conflicts;
}

function segmentsConflict(left, right) {
  const leftHorizontal = left.start.y === left.end.y;
  const rightHorizontal = right.start.y === right.end.y;
  if (leftHorizontal && rightHorizontal) {
    return left.start.y === right.start.y && rangesOverlapStrict(
      left.start.x, left.end.x, right.start.x, right.end.x
    );
  }
  if (!leftHorizontal && !rightHorizontal) {
    return left.start.x === right.start.x && rangesOverlapStrict(
      left.start.y, left.end.y, right.start.y, right.end.y
    );
  }
  const horizontal = leftHorizontal ? left : right;
  const vertical = leftHorizontal ? right : left;
  return vertical.start.x > Math.min(horizontal.start.x, horizontal.end.x) &&
    vertical.start.x < Math.max(horizontal.start.x, horizontal.end.x) &&
    horizontal.start.y > Math.min(vertical.start.y, vertical.end.y) &&
    horizontal.start.y < Math.max(vertical.start.y, vertical.end.y);
}

function rangesOverlapStrict(a1, a2, b1, b2) {
  return Math.min(Math.max(a1, a2), Math.max(b1, b2)) >
    Math.max(Math.min(a1, a2), Math.min(b1, b2));
}

function findObstacleAvoidingRoute(
  source,
  target,
  sourcePoint,
  targetPoint,
  nodes,
  preferredLaneY,
  margin,
  lanePitch
) {
  const clearance = 24;
  const routeTargetPoint = getTargetApproachPoint(target, targetPoint);
  const baseSourceLaneX = getEscapeLaneX(source, sourcePoint, "source", clearance);
  const targetUsesVerticalApproach = routeTargetPoint !== targetPoint;
  const baseTargetLaneX = targetUsesVerticalApproach
    ? routeTargetPoint.x
    : getEscapeLaneX(target, targetPoint, "target", clearance);
  const yCandidates = getGlobalLaneYCandidates(nodes, preferredLaneY, margin, lanePitch, clearance);

  for (const laneY of yCandidates) {
    const sourceLaneX = findClearVerticalLaneX(baseSourceLaneX, sourcePoint.y, laneY, nodes, source, target);
    const targetLaneX = targetUsesVerticalApproach
      ? baseTargetLaneX
      : findClearVerticalLaneX(baseTargetLaneX, routeTargetPoint.y, laneY, nodes, source, target);
    const candidate = route("obstacle-lane", [
      sourcePoint,
      { x: sourceLaneX, y: sourcePoint.y },
      { x: sourceLaneX, y: laneY },
      { x: targetLaneX, y: laneY },
      { x: targetLaneX, y: routeTargetPoint.y },
      routeTargetPoint,
      targetPoint
    ]);
    if (isRouteUsable(candidate.points, nodes, source, target, sourcePoint, targetPoint)) {
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
    (left, right) => Math.abs(left - preferredLaneY) - Math.abs(right - preferredLaneY)
  );
}

function findClearVerticalLaneX(preferredX, y1, y2, nodes, source, target) {
  const offsets = [0, 24, -24, 48, -48, 72, -72, 96, -96, 144, -144, 192, -192];
  for (const offset of offsets) {
    const x = preferredX + offset;
    if (!segmentHitsObstacle({ x, y: y1 }, { x, y: y2 }, nodes, source, target)) {
      return x;
    }
  }
  return preferredX;
}

function isRouteClear(points, nodes, source, target) {
  for (let index = 0; index < points.length - 1; index += 1) {
    if (segmentHitsObstacle(points[index], points[index + 1], nodes, source, target)) {
      return false;
    }
  }
  return true;
}

function exitsSourceWithoutCrossingBody(points, source, sourcePoint) {
  if (points.length < 2) {
    return true;
  }
  const next = points[1];
  if (sourcePoint.x >= source.x + source.width - 1 && next.x < sourcePoint.x) {
    return false;
  }
  if (sourcePoint.x <= source.x + 1 && next.x > sourcePoint.x) {
    return false;
  }
  return true;
}

function entersTargetWithoutCrossingBody(points, target, targetPoint) {
  if (points.length < 2) {
    return true;
  }
  const previous = points[points.length - 2];
  if (targetPoint.x <= target.x + 1 && previous.x > targetPoint.x) {
    return false;
  }
  if (targetPoint.x >= target.x + target.width - 1 && previous.x < targetPoint.x) {
    return false;
  }
  return true;
}

function segmentHitsObstacle(start, end, nodes, source, target) {
  const padding = 8;
  for (const node of nodes) {
    if (node.id === source.id || node.id === target.id) {
      continue;
    }
    const box = {
      left: node.x - padding,
      right: node.x + node.width + padding,
      top: node.y - padding,
      bottom: node.y + node.height + padding
    };
    if (start.y === end.y && horizontalSegmentIntersectsBox(start, end, box)) {
      return true;
    }
    if (start.x === end.x && verticalSegmentIntersectsBox(start, end, box)) {
      return true;
    }
  }
  return false;
}

function horizontalSegmentIntersectsBox(start, end, box) {
  const x1 = Math.min(start.x, end.x);
  const x2 = Math.max(start.x, end.x);
  return start.y >= box.top && start.y <= box.bottom && x2 > box.left && x1 < box.right;
}

function verticalSegmentIntersectsBox(start, end, box) {
  const y1 = Math.min(start.y, end.y);
  const y2 = Math.max(start.y, end.y);
  return start.x >= box.left && start.x <= box.right && y2 > box.top && y1 < box.bottom;
}

function uniqueRounded(values) {
  return [...new Set(values.map((value) => Math.round(value * 1000) / 1000))];
}

function compactPoints(points) {
  return points.filter((point, index) => {
    if (index === 0) {
      return true;
    }
    const previous = points[index - 1];
    return point.x !== previous.x || point.y !== previous.y;
  });
}

function getLabelPlacement(edge, source, target, sourcePoint, targetPoint) {
  const labelWidth = estimateLabelWidth(edge.label);
  if (target.kind === "cell" || target.kind === "assign" || target.kind === "output") {
    return {
      point: {
        x: targetPoint.x - labelWidth - 8,
        y: targetPoint.y - 6
      },
      anchor: "start"
    };
  }

  return {
    point: {
      x: sourcePoint.x + 8,
      y: sourcePoint.y - 6
    },
    anchor: "start"
  };
}

function estimateLabelWidth(label) {
  return Math.min(96, Math.max(28, String(label || "").length * 6));
}

function computeLevelBounds(nodes) {
  const bounds = new Map();
  for (const node of nodes) {
    const level = node.level ?? 0;
    const current = bounds.get(level) || {
      left: node.x,
      right: node.x + node.width
    };
    current.left = Math.min(current.left, node.x);
    current.right = Math.max(current.right, node.x + node.width);
    bounds.set(level, current);
  }
  return bounds;
}

function orderBucketsByTopology(buckets, levelKeys, edges) {
  const orders = new Map();
  const incomingByNode = new Map();
  const outgoingByNode = new Map();
  for (const edge of edges) {
    if (!incomingByNode.has(edge.target)) incomingByNode.set(edge.target, []);
    if (!outgoingByNode.has(edge.source)) outgoingByNode.set(edge.source, []);
    incomingByNode.get(edge.target).push(edge.source);
    outgoingByNode.get(edge.source).push(edge.target);
  }
  for (const level of levelKeys) {
    const nodes = buckets.get(level).sort(compareNodes);
    buckets.set(level, nodes);
    nodes.forEach((node, index) => orders.set(node.id, index));
  }

  for (let pass = 0; pass < 4; pass += 1) {
    for (const level of levelKeys.slice(1)) {
      sortLevelByNeighbors(buckets, orders, incomingByNode, level);
    }
    for (const level of levelKeys.slice(0, -1).toReversed()) {
      sortLevelByNeighbors(buckets, orders, outgoingByNode, level);
    }
  }
}

function sortLevelByNeighbors(buckets, orders, neighborsByNode, level) {
  const nodes = buckets.get(level);
  if (!nodes || nodes.length <= 1) {
    return;
  }

  const neighborRanks = new Map(nodes.map((node) => [
    node.id,
    (neighborsByNode.get(node.id) || [])
      .filter((neighborId) => orders.has(neighborId))
      .map((neighborId) => orders.get(neighborId))
  ]));

  nodes.sort((left, right) => {
    const leftRank = averageRank(neighborRanks.get(left.id), orders.get(left.id));
    const rightRank = averageRank(neighborRanks.get(right.id), orders.get(right.id));
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return compareNodes(left, right);
  });

  nodes.forEach((node, index) => orders.set(node.id, index));
}

function averageRank(values, fallback) {
  if (!values || values.length === 0) {
    return fallback ?? 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function assignLevels(graph) {
  const levels = new Map();
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, []]));
  const indegree = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    outgoing.get(edge.source).push(edge.target);
    indegree.set(edge.target, indegree.get(edge.target) + 1);
  }

  for (const node of graph.nodes) {
    levels.set(node.id, isExternalLevelSource(node) ? 0 : 1);
  }

  const queue = graph.nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const processed = new Set();
  let cursor = 0;
  let cycleCursor = 0;
  while (processed.size < graph.nodes.length) {
    if (cursor >= queue.length) {
      // Sequential netlists commonly contain feedback through state elements. Break one
      // remaining cycle edge instead of repeatedly increasing levels without a bound.
      while (cycleCursor < graph.nodes.length && processed.has(graph.nodes[cycleCursor].id)) {
        cycleCursor += 1;
      }
      const cycleEntry = graph.nodes[cycleCursor];
      if (!cycleEntry) break;
      queue.push(cycleEntry.id);
    }
    const nodeId = queue[cursor++];
    if (processed.has(nodeId)) continue;
    processed.add(nodeId);
    const nextLevel = (levels.get(nodeId) || 0) + 1;
    for (const targetId of outgoing.get(nodeId) || []) {
      if (processed.has(targetId)) continue;
      levels.set(targetId, Math.max(levels.get(targetId) || 1, nextLevel));
      const remaining = indegree.get(targetId) - 1;
      indegree.set(targetId, remaining);
      if (remaining === 0) queue.push(targetId);
    }
  }

  return levels;
}

function isExternalLevelSource(node) {
  return node.kind === "input" || node.kind === "implicit" || node.kind === "constant";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
