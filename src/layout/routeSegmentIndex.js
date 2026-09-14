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

/**
 * Reuse route segments for edges that were not invalidated by an override.
 * The index still represents the current graph, but avoids rebuilding the
 * segment records for every untouched edge in a large schematic.
 */
export function createIncrementalEdgeRouteSegmentIndex(
  previousEdges,
  currentEdges,
  affectedEdgeIds
) {
  if (!Array.isArray(previousEdges) || !Array.isArray(currentEdges) ||
      !(affectedEdgeIds instanceof Set)) {
    return createEdgeRouteSegmentIndex(currentEdges || []);
  }
  const affected = new Set([...affectedEdgeIds].map(String));
  const currentById = new Map(currentEdges.map((edge) => [String(edge.id), edge]));
  const reusable = previousEdges
    .filter((edge) => !affected.has(String(edge.id)) && currentById.has(String(edge.id)))
    .flatMap(getEdgeRouteSegments);
  const changed = currentEdges
    .filter((edge) => affected.has(String(edge.id)))
    .flatMap(getEdgeRouteSegments);
  return new RouteSegmentIndex([...reusable, ...changed]);
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
