import {
  getRouteSegments,
  nodeBox,
  orthogonalSegmentIntersectsBox
} from "./orthogonalRouting.js";
import {
  createNodeSpatialIndex,
  RouteSegmentIndex,
  SpatialHashIndex
} from "./spatialIndex.js";
import { compareGraphEdges } from "./layoutTopology.js";

export function placeWireLabels(edges, nodes, options = {}) {
  const segments = edges.flatMap((edge) => getRouteSegments(edge.points || [], edge.net)
    .map((segment) => ({ ...segment, edgeId: edge.id })));
  const collisionIndexes = {
    nodes: createNodeSpatialIndex(nodes),
    segments: new RouteSegmentIndex(segments),
    labels: new SpatialHashIndex()
  };
  const placedById = new Map();
  const compareEdges = options.compareEdges || compareGraphEdges;
  for (const edge of edges.toSorted(compareEdges)) {
    if (edge.showLabel === false) {
      placedById.set(edge.id, edge);
      continue;
    }
    const placement = findClearLabelPlacement(
      edge,
      collisionIndexes,
      options
    );
    if (!placement) {
      placedById.set(edge.id, { ...edge, showLabel: false });
      continue;
    }
    collisionIndexes.labels.insert(placement, placement.box);
    placedById.set(edge.id, {
      ...edge,
      labelPoint: placement.point,
      labelAnchor: placement.anchor,
      showLabel: true
    });
  }
  return edges.map((edge) => placedById.get(edge.id) || edge);
}

export function estimateWireLabelWidth(label) {
  return Math.max(12, String(label || "").length * 6.5);
}

function findClearLabelPlacement(edge, collisionIndexes, options) {
  const label = String(edge.label || "");
  if (!label && !options.includeEmpty) return null;
  const labelWidth = estimateWireLabelWidth(label);
  const minimumPadding = options.minimumPadding ?? 16;
  const candidates = getHorizontalCandidates(edge, labelWidth + minimumPadding, options.order);
  const baselineOffsets = options.baselineOffsets || [-8, 18, -26, 36];

  if (options.preferExisting && edge.labelPoint) {
    const anchor = edge.labelAnchor || "start";
    const preferred = {
      point: edge.labelPoint,
      anchor,
      box: labelBox(edge.labelPoint, labelWidth, anchor)
    };
    if (placementIsClear(preferred, edge, null, collisionIndexes, options)) {
      return preferred;
    }
  }

  for (const segment of candidates) {
    const centerX = (segment.start.x + segment.end.x) / 2;
    for (const baselineOffset of baselineOffsets) {
      const point = { x: centerX, y: segment.start.y + baselineOffset };
      const placement = { point, anchor: "middle", box: labelBox(point, labelWidth, "middle") };
      if (!placementIsClear(
        placement,
        edge,
        segment,
        collisionIndexes,
        options
      )) continue;
      return placement;
    }
  }
  return null;
}

function getHorizontalCandidates(edge, minimumLength, order = "last") {
  const candidates = getRouteSegments(edge.points || [], edge.net)
    .filter((segment) => Math.abs(segment.start.y - segment.end.y) < 0.5)
    .map((segment, index) => ({
      ...segment,
      index,
      length: Math.abs(segment.end.x - segment.start.x)
    }))
    .filter((segment) => segment.length >= minimumLength);
  if (order === "longest") {
    return candidates.toSorted((left, right) =>
      right.length - left.length || right.index - left.index);
  }
  return candidates.toSorted((left, right) =>
    right.index - left.index || right.length - left.length);
}

function placementIsClear(
  placement,
  edge,
  supportingSegment,
  collisionIndexes,
  options
) {
  if (options.checkCollisions === false) return true;
  const box = placement.box;
  if (collisionIndexes.nodes.query(box)
    .some((node) => boxesOverlap(box, nodeBox(node)))) return false;
  if (collisionIndexes.labels.query(box)
    .some((occupied) => boxesOverlap(box, occupied.box))) return false;
  return !collisionIndexes.segments.queryBox(box).some((candidate) =>
    supportingSegment && candidate.edgeId === edge.id && sameSegment(candidate, supportingSegment)
      ? false
      : orthogonalSegmentIntersectsBox(candidate.start, candidate.end, box));
}

function labelBox(point, width, anchor) {
  const left = anchor === "start"
    ? point.x
    : anchor === "end"
      ? point.x - width
      : point.x - width / 2;
  return {
    left: left - 3,
    right: left + width + 3,
    top: point.y - 13,
    bottom: point.y + 4
  };
}

function sameSegment(left, right) {
  return left.start.x === right.start.x && left.start.y === right.start.y &&
    left.end.x === right.end.x && left.end.y === right.end.y;
}

function boxesOverlap(left, right) {
  return left.left < right.right && left.right > right.left &&
    left.top < right.bottom && left.bottom > right.top;
}
