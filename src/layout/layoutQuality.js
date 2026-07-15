import {
  collinearSegmentsOverlap,
  getRouteSegments,
  segmentsConflict
} from "./orthogonalRouting.js";
import { RouteSegmentIndex } from "./spatialIndex.js";

export function analyzeLayoutQuality(graph) {
  const routeKinds = {};
  const routeStrategies = {};
  let totalLength = 0;
  let totalBends = 0;
  let maxBends = 0;
  let directRouteCount = 0;
  let hiddenLabelCount = 0;
  let totalDetour = 0;
  let detourRouteCount = 0;

  for (const edge of graph.edges || []) {
    const points = edge.points || [];
    const bends = Math.max(0, points.length - 2);
    const length = routeLength(points);
    const directDistance = points.length >= 2
      ? manhattanDistance(points[0], points.at(-1))
      : 0;
    totalLength += length;
    totalBends += bends;
    maxBends = Math.max(maxBends, bends);
    if (bends === 0) directRouteCount += 1;
    if (edge.showLabel === false) hiddenLabelCount += 1;
    if (directDistance > 0) {
      totalDetour += length / directDistance;
      detourRouteCount += 1;
    }
    const routeKind = edge.routeKind || "unknown";
    routeKinds[routeKind] = (routeKinds[routeKind] || 0) + 1;
    if (edge.routeStrategy) {
      routeStrategies[edge.routeStrategy] = (routeStrategies[edge.routeStrategy] || 0) + 1;
    }
  }

  const conflicts = countLayoutConflicts(graph.edges || []);
  const edgeCount = graph.edges?.length || 0;
  return {
    nodeCount: graph.nodes?.length || 0,
    edgeCount,
    directRouteCount,
    directRouteRatio: ratio(directRouteCount, edgeCount),
    totalLength: round(totalLength),
    averageLength: round(totalLength / Math.max(1, edgeCount)),
    totalBends,
    averageBends: round(totalBends / Math.max(1, edgeCount)),
    maxBends,
    averageDetourRatio: round(totalDetour / Math.max(1, detourRouteCount)),
    crossingCount: conflicts.crossings,
    overlapCount: conflicts.overlaps,
    hiddenLabelCount,
    routeKinds,
    routeStrategies
  };
}

export function compareLayoutQuality(baseGraph, candidateGraph) {
  const base = analyzeLayoutQuality(baseGraph);
  const candidate = analyzeLayoutQuality(candidateGraph);
  const keys = [
    "directRouteRatio",
    "totalLength",
    "averageLength",
    "totalBends",
    "averageBends",
    "maxBends",
    "averageDetourRatio",
    "crossingCount",
    "overlapCount",
    "hiddenLabelCount"
  ];
  return {
    base,
    candidate,
    delta: Object.fromEntries(keys.map((key) => [key, round(candidate[key] - base[key])]))
  };
}

function countLayoutConflicts(edges) {
  const index = new RouteSegmentIndex();
  let crossings = 0;
  let overlaps = 0;
  for (const edge of edges) {
    for (const segment of getRouteSegments(edge.points || [], edge.net)) {
      for (const existing of index.querySegment(segment)) {
        if (existing.net === segment.net || !segmentsConflict(existing, segment)) continue;
        if (collinearSegmentsOverlap(existing, segment)) overlaps += 1;
        else crossings += 1;
      }
      index.push(segment);
    }
  }
  return { crossings, overlaps };
}

function routeLength(points) {
  let length = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    length += manhattanDistance(points[index], points[index + 1]);
  }
  return length;
}

function manhattanDistance(left, right) {
  return Math.abs(right.x - left.x) + Math.abs(right.y - left.y);
}

function ratio(value, total) {
  return round(value / Math.max(1, total));
}

function round(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}
