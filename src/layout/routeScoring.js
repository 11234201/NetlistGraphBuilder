import { countRouteConflicts } from "./orthogonalRouting.js";

export const DEFAULT_ROUTE_COSTS = Object.freeze({
  crossing: 100000,
  primaryBend: 120,
  secondaryFanoutBend: 40,
  length: 1
});

export function scoreRouteCandidate(candidate, context = {}) {
  const costs = { ...DEFAULT_ROUTE_COSTS, ...(context.costs || {}) };
  const points = candidate.points || [];
  const crossings = countRouteConflicts(
    points,
    context.reservedSegments || [],
    context.net
  );
  const bends = Math.max(0, points.length - 2);
  const length = getRouteLength(points);
  const secondaryFanout = context.edgeIntent?.fanout > 1 && !context.edgeIntent.isPrimary;
  const bendCost = secondaryFanout ? costs.secondaryFanoutBend : costs.primaryBend;
  return {
    total: crossings * costs.crossing + bends * bendCost + length * costs.length,
    crossings,
    bends,
    length,
    bendCost
  };
}

export function compareRouteCandidates(left, right, context = {}) {
  const leftScore = scoreRouteCandidate(left, context);
  const rightScore = scoreRouteCandidate(right, context);
  return leftScore.total - rightScore.total ||
    leftScore.crossings - rightScore.crossings ||
    leftScore.bends - rightScore.bends ||
    leftScore.length - rightScore.length;
}

export function getRouteLength(points) {
  let length = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    length += Math.abs(points[index + 1].x - points[index].x) +
      Math.abs(points[index + 1].y - points[index].y);
  }
  return length;
}
