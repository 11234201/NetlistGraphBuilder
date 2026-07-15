import {
  collinearSegmentsOverlap,
  near,
  nodeBox,
  orthogonalSegmentIntersectsBox,
  routeFollowsEndpointSides,
  routePreservesEndpointAccess
} from "./orthogonalRouting.js";
import { createNodeSpatialIndex, segmentBox } from "./spatialIndex.js";

export function routeCandidateIsUsable(points, context, options = {}) {
  const nodeIndex = context.nodeIndex || createNodeSpatialIndex(context.nodes || []);
  const nodePadding = options.nodePadding ?? 8;
  for (let index = 0; index < points.length - 1; index += 1) {
    if (!routeSegmentIsClear(points[index], points[index + 1], {
      ...context,
      nodeIndex
    }, nodePadding, options.allowNodePaddingBoundary === true)) return false;
  }
  if (!routePreservesEndpointAccess(points, context.source, context.target)) return false;
  if (!routeFollowsEndpointSides(
    points,
    context.source,
    context.target,
    context.sourcePoint,
    context.targetPoint
  )) return false;
  return !options.rejectReservedOverlaps || !routeOverlapsReserved(
    points,
    context.net,
    context.reservedSegments || []
  );
}

export function routeSegmentIsClear(
  start,
  end,
  context,
  padding = 8,
  allowPaddingBoundary = false
) {
  if (!near(start.x, end.x) && !near(start.y, end.y)) return false;
  const segment = { start, end };
  return !context.nodeIndex.query(segmentBox(segment, padding)).some((node) =>
    node.id !== context.source.id &&
    node.id !== context.target.id &&
    intersectsObstacle(start, end, nodeBox(node, padding), allowPaddingBoundary)
  );
}

export function routeOverlapsReserved(points, net, reservedSegments) {
  for (let index = 0; index < points.length - 1; index += 1) {
    const candidate = { start: points[index], end: points[index + 1] };
    const reservedCandidates = typeof reservedSegments.querySegment === "function"
      ? reservedSegments.querySegment(candidate)
      : reservedSegments;
    for (const reserved of reservedCandidates) {
      if (reserved.net !== net && collinearSegmentsOverlap(candidate, reserved)) return true;
    }
  }
  return false;
}

function intersectsObstacle(start, end, box, allowPaddingBoundary) {
  if (!allowPaddingBoundary) return orthogonalSegmentIntersectsBox(start, end, box);
  if (near(start.y, end.y)) {
    return start.y > box.top && start.y < box.bottom &&
      Math.max(start.x, end.x) > box.left && Math.min(start.x, end.x) < box.right;
  }
  if (near(start.x, end.x)) {
    return start.x > box.left && start.x < box.right &&
      Math.max(start.y, end.y) > box.top && Math.min(start.y, end.y) < box.bottom;
  }
  return true;
}
