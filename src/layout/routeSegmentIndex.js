import { getRouteSegments, near } from "./orthogonalRouting.js";
import { RouteSegmentIndex } from "./spatialIndex.js";
import { getNetGroupKey } from "./layoutTopology.js";

export function getEdgeRouteSegments(edge) {
  const netGroupKey = getNetGroupKey(edge);
  return getRouteSegments(edge.points || [], edge.net, netGroupKey).map((segment, segmentIndex) => ({
    ...segment,
    edge,
    edgeId: edge.id,
    netGroupKey,
    physicalOwner: netGroupKey,
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
