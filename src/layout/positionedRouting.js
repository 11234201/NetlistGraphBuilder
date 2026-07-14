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
  const changedNodes = nodes.filter((node) => changedNodeIds.has(node.id));
  const rerouteEdgeIds = new Set(positionedGraph.edges
    .filter((edge) => edgeNeedsReroute(edge, changedNodeIds, changedNodes))
    .map((edge) => edge.id));
  const reservedSegments = positionedGraph.edges
    .filter((edge) => !rerouteEdgeIds.has(edge.id))
    .flatMap((edge) => getEdgeSegments(edge));
  const edges = positionedGraph.edges.map((edge) => {
    if (!rerouteEdgeIds.has(edge.id)) {
      return edge;
    }
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) return edge;
    const sourcePoint = getConnectionPoint(source, edge.sourcePin, "source");
    const targetPoint = getConnectionPoint(target, edge.targetPin, "target");
    const points = routeManhattan(
      source,
      target,
      sourcePoint,
      targetPoint,
      nodes,
      margin,
      edge.net,
      reservedSegments
    );
    const routedEdge = {
      ...edge,
      points,
      routeKind: "positioned-override",
      labelPoint: points[Math.max(1, points.length - 2)] || targetPoint,
      labelAnchor: "end"
    };
    reservedSegments.push(...getEdgeSegments(routedEdge));
    return routedEdge;
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

function edgeNeedsReroute(edge, changedNodeIds, changedNodes) {
  if (changedNodeIds.has(edge.source) || changedNodeIds.has(edge.target)) return true;
  return changedNodes.some((node) =>
    node.id !== edge.source && node.id !== edge.target && polylineIntersectsNode(edge.points, node)
  );
}

function routeManhattan(source, target, start, end, nodes, margin, net, reservedSegments) {
  if (
    start.x <= end.x &&
    Math.abs(start.y - end.y) < 0.5 &&
    routeCandidateIsClear([start, end], nodes, source, target, net, reservedSegments)
  ) {
    return [start, end];
  }

  if (start.x < end.x) {
    const minChannelX = start.x + 24;
    const maxChannelX = end.x - 24;
    if (minChannelX <= maxChannelX) {
      const middleX = (minChannelX + maxChannelX) / 2;
      for (const channelX of alternatingCandidates(middleX, margin, 16)) {
        if (channelX < minChannelX || channelX > maxChannelX) continue;
        const candidate = compactPoints([
          start,
          { x: channelX, y: start.y },
          { x: channelX, y: end.y },
          end
        ]);
        if (routeCandidateIsClear(candidate, nodes, source, target, net, reservedSegments)) {
          return candidate;
        }
      }
    }
  }

  return routeAroundNodes(source, target, start, end, nodes, margin, net, reservedSegments);
}

function routeAroundNodes(source, target, start, end, nodes, margin, net, reservedSegments) {
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxY = Math.max(...nodes.map((node) => node.y + node.height));
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const sourceLaneX = source.x + source.width + margin + attempt * margin;
    const targetLaneX = target.x - margin - attempt * margin;
    const laneYs = [minY - margin - attempt * margin, maxY + margin + attempt * margin]
      .toSorted((left, right) =>
        Math.abs(left - start.y) + Math.abs(left - end.y) -
        Math.abs(right - start.y) - Math.abs(right - end.y)
      );
    for (const laneY of laneYs) {
      const candidate = compactPoints([
        start,
        { x: sourceLaneX, y: start.y },
        { x: sourceLaneX, y: laneY },
        { x: targetLaneX, y: laneY },
        { x: targetLaneX, y: end.y },
        end
      ]);
      if (routeCandidateIsClear(candidate, nodes, source, target, net, reservedSegments)) {
        return candidate;
      }
    }
  }
  const laneY = minY - margin * 17;
  return compactPoints([
    start,
    { x: source.x + source.width + margin * 17, y: start.y },
    { x: source.x + source.width + margin * 17, y: laneY },
    { x: target.x - margin * 17, y: laneY },
    { x: target.x - margin * 17, y: end.y },
    end
  ]);
}

function routeCandidateIsClear(points, nodes, source, target, net, reservedSegments) {
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (!segmentClearOfNodes(start, end, nodes, source, target)) return false;
  }
  return !segmentsOverlapReserved(points, net, reservedSegments);
}

function segmentClearOfNodes(start, end, nodes, source, target) {
  if (start.y === end.y) return clearHorizontal(start.x, end.x, start.y, nodes, source, target);
  if (start.x === end.x) return clearVertical(start.x, start.y, end.y, nodes, source, target);
  return false;
}

function clearHorizontal(x1, x2, y, nodes, source, target) {
  const padding = 8;
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  return nodes.every((node) => node === source || node === target
    || y <= node.y - padding || y >= node.y + node.height + padding
    || maxX <= node.x - padding || minX >= node.x + node.width + padding);
}

function clearVertical(x, y1, y2, nodes, source, target) {
  const padding = 8;
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  return nodes.every((node) => node === source || node === target
    || x <= node.x - padding || x >= node.x + node.width + padding
    || maxY <= node.y - padding || minY >= node.y + node.height + padding);
}

function polylineIntersectsNode(points, node) {
  if (!Array.isArray(points)) return false;
  const padding = 8;
  const box = {
    left: node.x - padding,
    right: node.x + node.width + padding,
    top: node.y - padding,
    bottom: node.y + node.height + padding
  };
  return points.some((point, index) => index < points.length - 1 &&
    segmentIntersectsBox(point, points[index + 1], box));
}

function segmentIntersectsBox(start, end, box) {
  let entry = 0;
  let exit = 1;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const boundaries = [
    [-dx, start.x - box.left],
    [dx, box.right - start.x],
    [-dy, start.y - box.top],
    [dy, box.bottom - start.y]
  ];
  for (const [direction, distance] of boundaries) {
    if (direction === 0) {
      if (distance < 0) return false;
      continue;
    }
    const ratio = distance / direction;
    if (direction < 0) entry = Math.max(entry, ratio);
    else exit = Math.min(exit, ratio);
    if (entry > exit) return false;
  }
  return true;
}

function getEdgeSegments(edge) {
  const points = edge.points || [];
  const segments = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    segments.push({ start: points[index], end: points[index + 1], net: edge.net });
  }
  return segments;
}

function segmentsOverlapReserved(points, net, reservedSegments) {
  for (let index = 0; index < points.length - 1; index += 1) {
    const candidate = { start: points[index], end: points[index + 1] };
    for (const reserved of reservedSegments) {
      if (reserved.net === net) continue;
      if (collinearSegmentsOverlap(candidate, reserved)) return true;
    }
  }
  return false;
}

function collinearSegmentsOverlap(left, right) {
  const leftHorizontal = left.start.y === left.end.y;
  const rightHorizontal = right.start.y === right.end.y;
  if (leftHorizontal && rightHorizontal && left.start.y === right.start.y) {
    return rangesOverlap(left.start.x, left.end.x, right.start.x, right.end.x);
  }
  const leftVertical = left.start.x === left.end.x;
  const rightVertical = right.start.x === right.end.x;
  return leftVertical && rightVertical && left.start.x === right.start.x &&
    rangesOverlap(left.start.y, left.end.y, right.start.y, right.end.y);
}

function rangesOverlap(a1, a2, b1, b2) {
  return Math.min(Math.max(a1, a2), Math.max(b1, b2)) >
    Math.max(Math.min(a1, a2), Math.min(b1, b2));
}

function alternatingCandidates(center, pitch, count) {
  const values = [center];
  for (let index = 1; index <= count; index += 1) {
    values.push(center + index * pitch, center - index * pitch);
  }
  return values;
}

function compactPoints(points) {
  return points.filter((point, index) => index === 0 ||
    point.x !== points[index - 1].x || point.y !== points[index - 1].y);
}

function normalizeOverrides(value) {
  if (value instanceof Map) return value;
  return new Map(Object.entries(value || {}));
}
