import {
  collinearSegmentsOverlap,
  MINIMUM_FOREIGN_WIRE_SEPARATION,
  near,
  nodeBox,
  orthogonalSegmentIntersectsBox,
  parallelSegmentsOverlap,
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
  if (!isTargetEntryVisuallyClear(points, context)) return false;
  return !options.rejectReservedOverlaps || !routeOverlapsReserved(
    points,
    context.net,
    context.reservedSegments || [],
    context.netGroupKey
  );
}

/**
 * Keep foreign routes entering the same target on distinct visible vertical
 * lanes. The regular reservation threshold is deliberately small for dense
 * graphs; this target-scoped guard prevents two near-parallel entry legs from
 * looking merged after the SVG is fitted to a viewport.
 */
export function isTargetEntryVisuallyClear(points, context = {}) {
  const targetId = String(context.target?.id ?? "");
  const entries = context.targetEntryLanes?.get?.(targetId) || [];
  if (!targetId || entries.length === 0 || !context.target?.isFocusedRoot ||
    !isExternalEntrySource(context.source)) return true;
  const separation = Math.max(
    MINIMUM_FOREIGN_WIRE_SEPARATION,
    Number(context.targetEntrySeparation) ||
      Number(context.routingGeometry?.minimumTargetEntrySeparation) ||
      MINIMUM_FOREIGN_WIRE_SEPARATION
  );
  const candidateEntries = getTargetEntryVerticalSegments(points);
  for (const candidate of candidateEntries) {
    for (const existing of entries) {
      if ((existing.netGroupKey ?? existing.net) === context.netGroupKey) continue;
      if (!isExternalEntrySource({ kind: existing.sourceKind })) continue;
      if (Math.abs(candidate.x - Number(existing.x)) >= separation) continue;
      if (rangesOverlapStrict(
        candidate.minimum,
        candidate.maximum,
        Number(existing.minimum),
        Number(existing.maximum)
      )) return false;
    }
  }
  return true;
}

function isExternalEntrySource(node) {
  return node?.kind === "input" || node?.kind === "focus-input" ||
    node?.kind === "constant" || node?.kind === "implicit";
}

function getTargetEntryVerticalSegments(points) {
  const segments = [];
  for (let index = 0; index < (points?.length || 0) - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (Math.abs(Number(start?.x) - Number(end?.x)) >= 0.5) continue;
    const minimum = Math.min(Number(start.y), Number(end.y));
    const maximum = Math.max(Number(start.y), Number(end.y));
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum) ||
      maximum - minimum < 0.5) continue;
    segments.push({ x: Number(start.x), minimum, maximum });
  }
  return segments;
}

function rangesOverlapStrict(leftMinimum, leftMaximum, rightMinimum, rightMaximum) {
  return Math.min(leftMaximum, rightMaximum) > Math.max(leftMinimum, rightMinimum) + 0.01;
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
  const isVertical = near(start.x, end.x);
  const queryMethod = isVertical ? "queryVerticalSegment" : "queryHorizontalSegment";
  const segmentLength = isVertical
    ? Math.abs(Number(start.y) - Number(end.y))
    : Math.abs(Number(start.x) - Number(end.x));
  const directionalThreshold = Math.max(512, Number(context.nodeIndex.cellSize) * 4 || 512);
  const candidates = segmentLength >= directionalThreshold &&
    typeof context.nodeIndex[queryMethod] === "function"
    ? context.nodeIndex[queryMethod](segment, padding)
    : context.nodeIndex.query(segmentBox(segment, padding));
  return !candidates.some((node) =>
    node.id !== context.source.id &&
    node.id !== context.target.id &&
    intersectsObstacle(start, end, nodeBox(node, padding), allowPaddingBoundary)
  );
}

export function routeOverlapsReserved(points, net, reservedSegments, netGroupKey = undefined) {
  for (let index = 0; index < points.length - 1; index += 1) {
    const candidate = {
      start: points[index],
      end: points[index + 1],
      net,
      netGroupKey
    };
    const overlaps = (reserved) => {
      const sameNet = netGroupKey !== undefined && netGroupKey !== null
        ? (reserved?.netGroupKey ?? reserved?.net) === netGroupKey
        : reserved?.net === net;
      return !sameNet && (collinearSegmentsOverlap(candidate, reserved) ||
        parallelSegmentsOverlap(candidate, reserved));
    };
    const isVertical = Math.abs(candidate.start.x - candidate.end.x) < 0.5;
    const countMethod = isVertical ? "countVerticalSegment" : "countHorizontalSegment";
    if (typeof reservedSegments[countMethod] === "function") {
      if (reservedSegments[countMethod](
        candidate,
        MINIMUM_FOREIGN_WIRE_SEPARATION,
        overlaps,
        1
      ) > 0) return true;
      continue;
    }
    const reservedCandidates = isVertical &&
      typeof reservedSegments.queryVerticalSegment === "function"
      ? reservedSegments.queryVerticalSegment(candidate, MINIMUM_FOREIGN_WIRE_SEPARATION)
      : getReservedCandidates(reservedSegments, candidate);
    for (const reserved of reservedCandidates) {
      if (overlaps(reserved)) return true;
    }
  }
  return false;
}

function getReservedCandidates(reservedSegments, candidate) {
  return typeof reservedSegments.querySegment === "function"
    ? reservedSegments.querySegment(candidate, MINIMUM_FOREIGN_WIRE_SEPARATION)
    : reservedSegments;
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
