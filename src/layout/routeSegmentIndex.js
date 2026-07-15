import { getRouteSegments, near } from "./orthogonalRouting.js";
import { RouteSegmentIndex } from "./spatialIndex.js";

export function getEdgeRouteSegments(edge) {
  return getRouteSegments(edge.points || [], edge.net).map((segment, segmentIndex) => ({
    ...segment,
    edge,
    edgeId: edge.id,
    segmentIndex,
    orientation: getSegmentOrientation(segment)
  }));
}

export function createEdgeRouteSegmentIndex(edges) {
  return new RouteSegmentIndex(edges.flatMap(getEdgeRouteSegments));
}

export function getSegmentOrientation(segment) {
  if (near(segment.start.y, segment.end.y) && !near(segment.start.x, segment.end.x)) {
    return "horizontal";
  }
  if (near(segment.start.x, segment.end.x) && !near(segment.start.y, segment.end.y)) {
    return "vertical";
  }
  return null;
}
