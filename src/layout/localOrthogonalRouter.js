import {
  compactOrthogonalPoints,
  getTargetApproachPoint
} from "./orthogonalRouting.js";
import {
  routeCandidateIsUsable
} from "./routeCandidateValidation.js";
import { createNodeSpatialIndex } from "./spatialIndex.js";

export function routeLocalOrthogonalEdge(context) {
  const {
    source,
    target,
    start,
    end,
    nodes,
    margin,
    net,
    reservedSegments
  } = context;
  const nodeIndex = context.nodeIndex || createNodeSpatialIndex(nodes);
  const routeEnd = getTargetApproachPoint(target, end);
  const routeContext = {
    source,
    target,
    nodes,
    nodeIndex,
    net,
    reservedSegments
  };

  if (
    (Math.abs(start.x - end.x) < 0.5 || (
      start.x <= end.x && Math.abs(start.y - end.y) < 0.5
    )) && routeCandidateIsClear([start, end], routeContext)
  ) return [start, end];

  if (start.x < routeEnd.x) {
    const horizontalGap = routeEnd.x - start.x;
    const endpointClearance = Math.min(24, Math.max(2, horizontalGap / 4));
    const minChannelX = start.x + endpointClearance;
    const maxChannelX = routeEnd.x - endpointClearance;
    if (minChannelX <= maxChannelX) {
      const middleX = (minChannelX + maxChannelX) / 2;
      for (const channelX of alternatingCandidates(middleX, margin, 16)) {
        if (channelX < minChannelX || channelX > maxChannelX) continue;
        const candidate = compactOrthogonalPoints([
          start,
          { x: channelX, y: start.y },
          { x: channelX, y: routeEnd.y },
          routeEnd,
          end
        ]);
        if (routeCandidateIsClear(candidate, routeContext)) return candidate;
      }
    }
  }

  const localDetour = routeLocalDetour(start, routeEnd, end, routeContext);
  if (localDetour) return localDetour;
  return routeAroundNodes(start, routeEnd, end, margin, routeContext);
}

function routeLocalDetour(start, end, finalEnd, context) {
  const padding = 8;
  const forward = start.x < end.x;
  const horizontalGap = Math.abs(end.x - start.x);
  const endpointClearance = forward
    ? Math.min(24, Math.max(2, horizontalGap / 4))
    : 12;
  const sourceLaneX = start.x + endpointClearance;
  const targetLaneX = end.x - endpointClearance;
  const minRouteX = Math.min(sourceLaneX, targetLaneX);
  const maxRouteX = Math.max(sourceLaneX, targetLaneX);
  const minNodeY = Math.min(...context.nodes.map((node) => node.y));
  const maxNodeY = Math.max(...context.nodes.map((node) => node.y + node.height));
  const relevantNodes = context.nodeIndex.query({
    left: minRouteX - padding,
    right: maxRouteX + padding,
    top: minNodeY - padding,
    bottom: maxNodeY + padding
  });
  const laneYs = uniqueNumbers([
    start.y,
    end.y,
    (start.y + end.y) / 2,
    ...relevantNodes.flatMap((node) => [node.y - padding, node.y + node.height + padding])
  ]).toSorted((left, right) =>
    localDetourCost(left, start.y, end.y) - localDetourCost(right, start.y, end.y));

  for (const laneY of laneYs) {
    const candidate = compactOrthogonalPoints([
      start,
      { x: sourceLaneX, y: start.y },
      { x: sourceLaneX, y: laneY },
      { x: targetLaneX, y: laneY },
      { x: targetLaneX, y: end.y },
      end,
      finalEnd
    ]);
    if (routeCandidateIsClear(candidate, context)) return candidate;
  }
  return null;
}

function routeAroundNodes(start, end, finalEnd, margin, context) {
  const minY = Math.min(...context.nodes.map((node) => node.y));
  const maxY = Math.max(...context.nodes.map((node) => node.y + node.height));
  const attempts = Math.min(256, Math.max(32, context.nodes.length + 8));
  let lastCandidate = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const sourceLaneX = context.source.x + context.source.width + margin + attempt * margin;
    const targetLaneX = context.target.x - margin - attempt * margin;
    const laneYs = [minY - margin - attempt * margin, maxY + margin + attempt * margin]
      .toSorted((left, right) =>
        Math.abs(left - start.y) + Math.abs(left - end.y) -
        Math.abs(right - start.y) - Math.abs(right - end.y));
    for (const laneY of laneYs) {
      const candidate = compactOrthogonalPoints([
        start,
        { x: sourceLaneX, y: start.y },
        { x: sourceLaneX, y: laneY },
        { x: targetLaneX, y: laneY },
        { x: targetLaneX, y: end.y },
        end,
        finalEnd
      ]);
      lastCandidate = candidate;
      if (routeCandidateIsClear(candidate, context)) return candidate;
    }
  }
  return lastCandidate || [start, finalEnd];
}

function routeCandidateIsClear(points, context) {
  return routeCandidateIsUsable(points, context, {
    allowNodePaddingBoundary: true,
    rejectReservedOverlaps: true
  });
}

function localDetourCost(laneY, startY, endY) {
  return Math.abs(laneY - startY) + Math.abs(laneY - endY);
}

function uniqueNumbers(values) {
  return [...new Set(values.map((value) => Math.round(value * 1000) / 1000))];
}

function alternatingCandidates(center, pitch, count) {
  const values = [center];
  for (let index = 1; index <= count; index += 1) {
    values.push(center + index * pitch, center - index * pitch);
  }
  return values;
}
