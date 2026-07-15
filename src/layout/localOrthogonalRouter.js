import { iterateLocalRouteCandidates } from "./localRouteCandidates.js";
import { routeCandidateIsUsable } from "./routeCandidateValidation.js";
import { createNodeSpatialIndex } from "./spatialIndex.js";

export function routeLocalOrthogonalEdge(context) {
  const nodeIndex = context.nodeIndex || createNodeSpatialIndex(context.nodes);
  const routeContext = { ...context, nodeIndex };
  let lastCandidate = null;
  for (const candidate of iterateLocalRouteCandidates(routeContext)) {
    lastCandidate = candidate;
    if (routeCandidateIsUsable(candidate.points, {
      source: context.source,
      target: context.target,
      nodes: context.nodes,
      nodeIndex,
      net: context.net,
      reservedSegments: context.reservedSegments
    }, {
      allowNodePaddingBoundary: true,
      rejectReservedOverlaps: true
    })) return candidate.points;
  }
  return lastCandidate?.points || [context.start, context.end];
}
