import { DEFAULT_LAYOUT_POLICY, normalizeLayoutPolicy } from "./layoutPolicy.js";
import {
  buildNodePorts,
  computeBounds,
  DEFAULT_CELL_PIN_PITCH,
  getConnectionPoint,
  measureNode
} from "./nodeGeometry.js";
import {
  alignDrivenTargetsToDriverPins,
  applyBranchAwareLanes,
  applyNodePositionOverrides,
  applyNodeSizeOverride,
  applySingleFanoutInputLocality,
  compareNodes,
  computeLevelXs,
  resolveLevelOverlaps,
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
  const routePlan = planRouting(graph, levels);
  const xSpacing = Math.max(
    Number(policy.spacing.x) || 260,
    208 + routePlan.maxSideLanes * wireLanePitch
  );
  const topWireSpace =
    options.topWireSpace || Math.max(80, 48 + routePlan.longLaneCount * topWireLanePitch);
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
    margin
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
      nextY += Math.max(ySpacing, size.height + 16);
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
    alignDrivenTargetsToDriverPins(positionedNodes, graph.edges, levelKeys);
  }
  resolveLevelOverlaps(positionedNodes, levelKeys, margin);
  if (policy.features.localizeSingleFanoutInputs) {
    applySingleFanoutInputLocality(positionedNodes, graph.edges, margin);
  }
  resolveOutputOverlaps(positionedNodes, margin);
  applyNodePositionOverrides(positionedNodes, options.nodePositions);

  const nodeById = new Map(positionedNodes.map((node) => [node.id, node]));
  const levelBounds = computeLevelBounds(positionedNodes);
  const positionedEdges = graph.edges.map((edge) => {
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
      margin
    );
    const label = getLabelPlacement(edge, source, target, sourcePoint, targetPoint);

    return {
      ...edge,
      points: route.points,
      routeKind: route.kind,
      labelPoint: label.point,
      labelAnchor: label.anchor
    };
  });

  const bounds = computeBounds(positionedNodes);

  return {
    ...graph,
    nodes: positionedNodes,
    edges: positionedEdges,
    width: bounds.width + margin,
    height: bounds.height + margin
  };
}

function planRouting(graph, levels) {
  const edges = new Map();
  const channelLanes = new Map();
  const longSourceLanes = new Map();
  const longTargetLanes = new Map();
  let longLaneCount = 0;
  let maxSideLanes = 1;

  for (const edge of graph.edges) {
    const sourceLevel = levels.get(edge.source) || 0;
    const targetLevel = levels.get(edge.target) || sourceLevel + 1;
    const levelDistance = targetLevel - sourceLevel;

    if (levelDistance <= 1) {
      const key = `${sourceLevel}->${targetLevel}`;
      const lane = channelLanes.get(key) || 0;
      channelLanes.set(key, lane + 1);
      maxSideLanes = Math.max(maxSideLanes, lane + 1);
      edges.set(edge.id, { kind: "channel", lane });
      continue;
    }

    const sourceKey = `source:${sourceLevel}`;
    const targetKey = `target:${targetLevel}`;
    const sourceLane = longSourceLanes.get(sourceKey) || 0;
    const targetLane = longTargetLanes.get(targetKey) || 0;
    longSourceLanes.set(sourceKey, sourceLane + 1);
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
  margin
) {
  const sourceLevel = source.level ?? 0;
  const targetLevel = target.level ?? sourceLevel + 1;
  const levelDistance = targetLevel - sourceLevel;
  const sourceBounds = levelBounds.get(sourceLevel) || { right: source.x + source.width };
  const targetBounds = levelBounds.get(targetLevel) || { left: target.x };
  const horizontalGap = targetPoint.x - sourcePoint.x;
  const yDelta = Math.abs(targetPoint.y - sourcePoint.y);

  if (horizontalGap > 0 && yDelta <= 4) {
    const directRoute = route("direct", [sourcePoint, targetPoint]);
    if (isRouteUsable(directRoute.points, nodes, source, target, sourcePoint, targetPoint)) {
      return directRoute;
    }
  }

  if (horizontalGap > 64 && yDelta <= 32) {
    const laneX = sourcePoint.x + Math.max(32, horizontalGap / 2);
    const localRoute = route("local-dogleg", [
      sourcePoint,
      { x: laneX, y: sourcePoint.y },
      { x: laneX, y: targetPoint.y },
      targetPoint
    ]);
    if (isRouteUsable(localRoute.points, nodes, source, target, sourcePoint, targetPoint)) {
      return localRoute;
    }
  }

  if (levelDistance <= 1) {
    const laneX = sourceBounds.right + 26 + (edgePlan?.lane || 0) * wireLanePitch;
    const channelRoute = route("channel", [
      sourcePoint,
      { x: laneX, y: sourcePoint.y },
      { x: laneX, y: targetPoint.y },
      targetPoint
    ]);
    if (isRouteUsable(channelRoute.points, nodes, source, target, sourcePoint, targetPoint)) {
      return channelRoute;
    }
  }

  const sourceLaneX = sourceBounds.right + 20 + (edgePlan?.sourceLane || 0) * wireLanePitch;
  const targetLaneX = targetBounds.left - 24 - (edgePlan?.targetLane || 0) * wireLanePitch;
  if (targetLaneX <= sourceLaneX + 24) {
    const laneX = sourcePoint.x + Math.max(32, (targetPoint.x - sourcePoint.x) / 2);
    const localRoute = route("local-dogleg", [
      sourcePoint,
      { x: laneX, y: sourcePoint.y },
      { x: laneX, y: targetPoint.y },
      targetPoint
    ]);
    if (isRouteUsable(localRoute.points, nodes, source, target, sourcePoint, targetPoint)) {
      return localRoute;
    }
  }

  const topLaneY = margin / 2 + (edgePlan?.topLane || 0) * topWireLanePitch;
  const topRoute = route("top-lane", [
    sourcePoint,
    { x: sourceLaneX, y: sourcePoint.y },
    { x: sourceLaneX, y: topLaneY },
    { x: targetLaneX, y: topLaneY },
    { x: targetLaneX, y: targetPoint.y },
    targetPoint
  ]);
  if (isRouteUsable(topRoute.points, nodes, source, target, sourcePoint, targetPoint)) {
    return topRoute;
  }

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
    entersTargetWithoutCrossingBody(points, target, targetPoint)
  );
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
  const baseSourceLaneX = getEscapeLaneX(source, sourcePoint, "source", clearance);
  const baseTargetLaneX = getEscapeLaneX(target, targetPoint, "target", clearance);
  const yCandidates = getGlobalLaneYCandidates(nodes, preferredLaneY, margin, lanePitch, clearance);

  for (const laneY of yCandidates) {
    const sourceLaneX = findClearVerticalLaneX(baseSourceLaneX, sourcePoint.y, laneY, nodes, source, target);
    const targetLaneX = findClearVerticalLaneX(baseTargetLaneX, targetPoint.y, laneY, nodes, source, target);
    const candidate = route("obstacle-lane", [
      sourcePoint,
      { x: sourceLaneX, y: sourcePoint.y },
      { x: sourceLaneX, y: laneY },
      { x: targetLaneX, y: laneY },
      { x: targetLaneX, y: targetPoint.y },
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
    { x: baseTargetLaneX, y: targetPoint.y },
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
