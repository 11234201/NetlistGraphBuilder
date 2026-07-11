import { buildNodePorts, computeBounds, getConnectionPoint } from "./nodeGeometry.js";

export function applyPositionedOverrides(positionedGraph, options = {}) {
  const nodePositions = normalizeOverrides(options.nodePositions);
  const nodeSizes = normalizeOverrides(options.nodeSizes);
  if (nodePositions.size === 0 && nodeSizes.size === 0) {
    return positionedGraph;
  }
  const cellPinPitch = options.layoutPolicy?.spacing?.cellPinPitch;
  const margin = options.layoutPolicy?.spacing?.margin || 48;
  const nodes = positionedGraph.nodes.map((node) => {
    const position = nodePositions.get(node.id);
    const size = nodeSizes.get(node.id);
    const next = {
      ...node,
      x: position?.x ?? node.x,
      y: position?.y ?? node.y,
      width: size?.width ?? node.width,
      height: size?.height ?? node.height
    };
    next.ports = buildNodePorts(next, next, cellPinPitch);
    return next;
  });
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const changedNodeIds = new Set([...nodePositions.keys(), ...nodeSizes.keys()]);
  const edges = positionedGraph.edges.map((edge) => {
    if (!changedNodeIds.has(edge.source) && !changedNodeIds.has(edge.target)) {
      return edge;
    }
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) return edge;
    const sourcePoint = getConnectionPoint(source, edge.sourcePin, "source");
    const targetPoint = getConnectionPoint(target, edge.targetPin, "target");
    const points = routeManhattan(source, target, sourcePoint, targetPoint, nodes, margin);
    return {
      ...edge,
      points,
      routeKind: "positioned-override",
      labelPoint: points[Math.max(1, points.length - 2)] || targetPoint,
      labelAnchor: "end"
    };
  });
  const bounds = computeBounds(nodes);
  return {
    ...positionedGraph,
    nodes,
    edges,
    width: bounds.width + margin,
    height: bounds.height + margin,
    hasPositionOverrides: nodePositions.size > 0 || nodeSizes.size > 0
  };
}

function routeManhattan(source, target, start, end, nodes, margin) {
  if (Math.abs(start.y - end.y) < 0.5 && clearHorizontal(start.x, end.x, start.y, nodes, source, target)) {
    return [start, end];
  }
  let channelX = start.x <= end.x
    ? start.x + Math.max(32, (end.x - start.x) / 2)
    : Math.max(start.x, end.x) + margin;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    if (clearRoute(start, end, channelX, nodes, source, target)) {
      return [start, { x: channelX, y: start.y }, { x: channelX, y: end.y }, end];
    }
    channelX += margin;
  }
  return [start, { x: channelX, y: start.y }, { x: channelX, y: end.y }, end];
}

function clearRoute(start, end, channelX, nodes, source, target) {
  return clearHorizontal(start.x, channelX, start.y, nodes, source, target)
    && clearVertical(channelX, start.y, end.y, nodes, source, target)
    && clearHorizontal(channelX, end.x, end.y, nodes, source, target);
}

function clearHorizontal(x1, x2, y, nodes, source, target) {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  return nodes.every((node) => node === source || node === target
    || y <= node.y || y >= node.y + node.height
    || maxX <= node.x || minX >= node.x + node.width);
}

function clearVertical(x, y1, y2, nodes, source, target) {
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  return nodes.every((node) => node === source || node === target
    || x <= node.x || x >= node.x + node.width
    || maxY <= node.y || minY >= node.y + node.height);
}

function normalizeOverrides(value) {
  if (value instanceof Map) return value;
  return new Map(Object.entries(value || {}));
}
