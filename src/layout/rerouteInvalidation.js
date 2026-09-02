import {
  nodeBox,
  segmentIntersectsBox
} from "./orthogonalRouting.js";
import { createEdgeRouteSegmentIndex } from "./routeSegmentIndex.js";
import { getNetGroupKey } from "./layoutTopology.js";

export function collectRerouteEdgeIds(edges, changedNodes, changedNodeIds = null) {
  const changedIds = changedNodeIds || new Set(changedNodes.map((node) => node.id));
  const rerouteEdgeIds = new Set();
  for (const edge of edges) {
    if (changedIds.has(edge.source) || changedIds.has(edge.target)) {
      rerouteEdgeIds.add(edge.id);
    }
  }
  if (changedNodes.length === 0) return rerouteEdgeIds;

  const edgeById = new Map(edges.map((edge) => [edge.id, edge]));
  const segmentIndex = createEdgeRouteSegmentIndex(edges);

  for (const node of changedNodes) {
    const box = nodeBox(node, 8);
    for (const segment of segmentIndex.queryBox(box)) {
      const edge = edgeById.get(segment.edgeId);
      if (!edge || edge.source === node.id || edge.target === node.id) continue;
      if (segmentIntersectsBox(segment.start, segment.end, box)) {
        rerouteEdgeIds.add(edge.id);
      }
    }
  }
  return rerouteEdgeIds;
}

/**
 * A physical wire route is shared by every logical edge in a driver/net
 * group. Once one member is invalidated, retain no stale trunk or branch from
 * that group in the reserved geometry.
 */
export function expandRerouteEdgeIdsByNetGroup(edges, rerouteEdgeIds) {
  const affectedGroups = new Set(
    edges.filter((edge) => rerouteEdgeIds.has(edge.id)).map(getNetGroupKey)
  );
  if (affectedGroups.size === 0) return new Set(rerouteEdgeIds);
  return new Set(edges
    .filter((edge) => affectedGroups.has(getNetGroupKey(edge)))
    .map((edge) => edge.id));
}
