import { iterateLocalRouteCandidates } from "./localRouteCandidates.js";
import { routeCandidateIsUsable } from "./routeCandidateValidation.js";
import { compareRouteCandidates, scoreRouteCandidate } from "./routeScoring.js";
import { createNodeSpatialIndex } from "./spatialIndex.js";

export function routeLocalOrthogonalEdge(context) {
  const nodeIndex = context.nodeIndex || createNodeSpatialIndex(context.nodes);
  const routeContext = { ...context, nodeIndex };
  let lastCandidate = null;
  let bestUsableCandidate = null;
  const scoreContext = {
    reservedSegments: context.reservedSegments,
    net: context.net,
    edgeIntent: context.edgeIntent
  };
  for (const candidate of iterateLocalRouteCandidates(routeContext)) {
    lastCandidate = candidate;
    const usable = routeCandidateIsUsable(candidate.points, {
      source: context.source,
      target: context.target,
      nodes: context.nodes,
      nodeIndex,
      net: context.net,
      reservedSegments: context.reservedSegments
    }, {
      allowNodePaddingBoundary: true,
      rejectReservedOverlaps: true
    });
    if (!usable) continue;
    if (scoreRouteCandidate(candidate, scoreContext).crossings === 0) return candidate.points;
    if (!bestUsableCandidate ||
      compareRouteCandidates(candidate, bestUsableCandidate, scoreContext) < 0) {
      bestUsableCandidate = candidate;
    }
  }
  return bestUsableCandidate?.points || lastCandidate?.points || [context.start, context.end];
}
