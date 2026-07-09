import { inferPinDirection, isInvertingOutputGate } from "../infer/defaultCellRules.js";

export const DEFAULT_WIRE_LANE_PITCH = 18;
export const DEFAULT_TOP_WIRE_LANE_PITCH = 16;

export function layoutGraph(graph, options = {}) {
  const ySpacing = options.ySpacing || 88;
  const margin = options.margin || 48;
  const wireLanePitch = clamp(
    Number(options.wireLanePitch) || DEFAULT_WIRE_LANE_PITCH,
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
  const xSpacing =
    options.xSpacing || Math.max(320, 260 + routePlan.maxSideLanes * wireLanePitch);
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

  for (const level of levelKeys) {
    const nodes = buckets.get(level);
    for (const [index, node] of nodes.entries()) {
      const size = measureNode(node);
      positionedNodes.push({
        ...node,
        x: margin + level * xSpacing,
        y: topWireSpace + margin + index * ySpacing,
        level,
        width: size.width,
        height: size.height,
        ports: buildNodePorts(node, size)
      });
    }
  }

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

function applyNodePositionOverrides(nodes, nodePositions) {
  if (!nodePositions) {
    return;
  }

  for (const node of nodes) {
    const override = getNodePositionOverride(nodePositions, node.id);
    if (!override) {
      continue;
    }
    const x = Number(override.x);
    const y = Number(override.y);
    if (Number.isFinite(x)) {
      node.x = x;
    }
    if (Number.isFinite(y)) {
      node.y = y;
    }
  }
}

function getNodePositionOverride(nodePositions, nodeId) {
  if (nodePositions instanceof Map) {
    return nodePositions.get(nodeId);
  }
  if (Array.isArray(nodePositions)) {
    return nodePositions.find((item) => item?.id === nodeId);
  }
  if (typeof nodePositions === "object") {
    return Object.hasOwn(nodePositions, nodeId) ? nodePositions[nodeId] : null;
  }
  return null;
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
  return route("top-lane", [
    sourcePoint,
    { x: sourceLaneX, y: sourcePoint.y },
    { x: sourceLaneX, y: topLaneY },
    { x: targetLaneX, y: topLaneY },
    { x: targetLaneX, y: targetPoint.y },
    targetPoint
  ]);
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
  for (const level of levelKeys) {
    const nodes = buckets.get(level).sort(compareNodes);
    buckets.set(level, nodes);
    nodes.forEach((node, index) => orders.set(node.id, index));
  }

  for (let pass = 0; pass < 4; pass += 1) {
    for (const level of levelKeys.slice(1)) {
      sortLevelByNeighbors(buckets, orders, edges, level, "incoming");
    }
    for (const level of levelKeys.slice(0, -1).toReversed()) {
      sortLevelByNeighbors(buckets, orders, edges, level, "outgoing");
    }
  }
}

function sortLevelByNeighbors(buckets, orders, edges, level, direction) {
  const nodes = buckets.get(level);
  if (!nodes || nodes.length <= 1) {
    return;
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const neighborRanks = new Map(nodes.map((node) => [node.id, []]));

  for (const edge of edges) {
    if (direction === "incoming" && nodeIds.has(edge.target) && orders.has(edge.source)) {
      neighborRanks.get(edge.target).push(orders.get(edge.source));
    } else if (direction === "outgoing" && nodeIds.has(edge.source) && orders.has(edge.target)) {
      neighborRanks.get(edge.source).push(orders.get(edge.target));
    }
  }

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
  const maxIterations = Math.max(4, graph.nodes.length * 2);

  for (const node of graph.nodes) {
    if (node.kind === "input" || node.kind === "implicit" || node.kind === "constant") {
      levels.set(node.id, 0);
    } else {
      levels.set(node.id, 1);
    }
  }

  for (let index = 0; index < maxIterations; index += 1) {
    let changed = false;
    for (const edge of graph.edges) {
      const sourceLevel = levels.get(edge.source) || 0;
      const targetLevel = levels.get(edge.target) || 0;
      if (targetLevel <= sourceLevel) {
        levels.set(edge.target, sourceLevel + 1);
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }

  const outputLevel = Math.max(...levels.values(), 1);
  for (const node of graph.nodes) {
    if (node.kind === "output") {
      levels.set(node.id, Math.max(levels.get(node.id) || 1, outputLevel));
    }
  }

  return levels;
}

function compareNodes(left, right) {
  const leftOrder = left.order ?? 1000;
  const rightOrder = right.order ?? 1000;
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  return `${left.kind}:${left.label}`.localeCompare(`${right.kind}:${right.label}`);
}

function measureNode(node) {
  const labelLength = Math.max(
    String(node.label || "").length,
    String(node.subtitle || "").length,
    String(node.title || "").length
  );
  const width = clamp(labelLength * 7 + 42, node.kind === "cell" ? 128 : 92, 220);
  const pinCount = getMaxPinCount(node);
  const height =
    node.kind === "cell" || node.kind === "assign"
      ? Math.max(58, 18 + pinCount * 18)
      : 36;
  return { width, height };
}

function buildNodePorts(node, size) {
  if (node.kind === "input" || node.kind === "implicit" || node.kind === "constant") {
    return [
      {
        pin: node.label,
        direction: "output",
        side: "right",
        x: size.width,
        y: size.height / 2
      }
    ];
  }

  if (node.kind === "output") {
    return [
      {
        pin: node.label,
        direction: "input",
        side: "left",
        x: 0,
        y: size.height / 2
      }
    ];
  }

  if (node.kind === "assign") {
    return [
      { pin: "I", direction: "input", side: "left", x: 0, y: size.height / 2 },
      { pin: "Z", direction: "output", side: "right", x: size.width, y: size.height / 2 }
    ];
  }

  const inputPins = [];
  const outputPins = [];
  for (const pin of node.ref?.pins || []) {
    const direction = inferPinDirection(pin.pin).direction;
    const port = {
      pin: pin.pinDisplayName || pin.pin,
      direction,
      side: direction === "output" ? "right" : "left",
      x: direction === "output" ? size.width : 0,
      y: 0
    };
    if (direction === "output") {
      outputPins.push(port);
    } else {
      inputPins.push(port);
    }
  }

  placePorts(inputPins, size.height);
  placePorts(outputPins, size.height);
  return [...inputPins, ...outputPins];
}

function placePorts(ports, height) {
  if (ports.length === 0) {
    return;
  }

  const gap = height / (ports.length + 1);
  ports.forEach((port, index) => {
    port.y = gap * (index + 1);
  });
}

function getConnectionPoint(node, pin, role) {
  const preferredDirection = role === "source" ? "output" : "input";
  const port =
    node.ports?.find((candidate) => candidate.pin === pin && candidate.direction === preferredDirection) ||
    node.ports?.find((candidate) => candidate.direction === preferredDirection) ||
    node.ports?.[0];

  const x = node.x + (port?.x ?? (role === "source" ? node.width : 0));
  const y = node.y + (port?.y ?? node.height / 2);
  const bubbleOffset =
    role === "source" &&
    preferredDirection === "output" &&
    node.kind === "cell" &&
    isInvertingOutputGate(node.gateKind)
      ? 10
      : 0;

  return { x: x + bubbleOffset, y };
}

function getMaxPinCount(node) {
  if (node.kind === "assign") {
    return 1;
  }
  if (node.kind !== "cell") {
    return 1;
  }

  let inputs = 0;
  let outputs = 0;
  for (const pin of node.ref?.pins || []) {
    if (inferPinDirection(pin.pin).direction === "output") {
      outputs += 1;
    } else {
      inputs += 1;
    }
  }
  return Math.max(inputs, outputs, 1);
}

function computeBounds(nodes) {
  let width = 0;
  let height = 0;
  for (const node of nodes) {
    width = Math.max(width, node.x + node.width);
    height = Math.max(height, node.y + node.height);
  }
  return { width, height };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
