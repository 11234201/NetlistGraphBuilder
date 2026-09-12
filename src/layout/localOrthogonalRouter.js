import { iterateLocalRouteCandidates } from "./localRouteCandidates.js";
import { routeCandidateIsUsable } from "./routeCandidateValidation.js";
import { compareRouteCandidates, scoreRouteCandidate } from "./routeScoring.js";
import { createNodeSpatialIndex } from "./spatialIndex.js";

export function routeLocalOrthogonalEdge(context) {
  return selectLocalOrthogonalRoute(context).points;
}

export function selectLocalOrthogonalRoute(context) {
  const nodeIndex = context.nodeIndex || createNodeSpatialIndex(context.nodes);
  const routeContext = { ...context, nodeIndex };
  let bestUsableCandidate = null;
  let candidateCount = 0;
  const scoreContext = {
    reservedSegments: context.reservedSegments,
    net: context.net,
    netGroupKey: context.netGroupKey,
    edgeIntent: context.edgeIntent
  };
  for (const candidate of iterateLocalRouteCandidates(routeContext)) {
    candidateCount += 1;
    const usable = routeCandidateIsUsable(candidate.points, {
      source: context.source,
      target: context.target,
      nodes: context.nodes,
      nodeIndex,
      net: context.net,
      netGroupKey: context.netGroupKey,
      reservedSegments: context.reservedSegments
    }, {
      allowNodePaddingBoundary: true,
      rejectReservedOverlaps: true
    });
    if (!usable) continue;
    if (scoreRouteCandidate(candidate, scoreContext).crossings === 0) {
      return { ...candidate, status: "routed" };
    }
    if (!bestUsableCandidate ||
      compareRouteCandidates(candidate, bestUsableCandidate, scoreContext) < 0) {
      bestUsableCandidate = candidate;
    }
  }
  if (bestUsableCandidate) return { ...bestUsableCandidate, status: "routed" };
  return {
    kind: "unroutable",
    status: "unroutable",
    points: [],
    diagnostics: [{
      code: "local-route-unroutable",
      candidateCount,
      sourceNodeId: context.source?.id,
      targetNodeId: context.target?.id,
      netGroupKey: context.netGroupKey
    }]
  };
}
