import {
  getRouteSegments,
  nodeBox,
  segmentIntersectsBox
} from "./orthogonalRouting.js";
import { RouteSegmentIndex } from "./spatialIndex.js";

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
  const segmentIndex = new RouteSegmentIndex(edges.flatMap((edge) =>
    getRouteSegments(edge.points || [], edge.net).map((segment) => ({
      ...segment,
      edgeId: edge.id
    }))));

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
