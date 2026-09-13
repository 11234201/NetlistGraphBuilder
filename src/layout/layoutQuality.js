import {
  collinearSegmentsOverlap,
  getRouteSegments,
  MINIMUM_FOREIGN_WIRE_SEPARATION,
  near,
  parallelSegmentsOverlap,
  segmentsConflict
} from "./orthogonalRouting.js";
import { RouteSegmentIndex } from "./spatialIndex.js";
import { buildWireRoutes } from "./wireRoutes.js";

export function analyzeLayoutQuality(graph) {
  const routeKinds = {};
  const routeStrategies = {};
  let totalLength = 0;
  let totalBends = 0;
  let maxBends = 0;
  let directRouteCount = 0;
  let hiddenLabelCount = 0;
  let outerRouteCount = 0;
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
    if (isOuterRoute(edge)) outerRouteCount += 1;
  }

  const conflicts = countLayoutConflicts(graph.edges || []);
  const edgeCount = graph.edges?.length || 0;
  const wireRoutes = Array.isArray(graph.wireRoutes) && graph.wireRoutes.length > 0
    ? graph.wireRoutes
    : buildWireRoutes(graph.edges || []);
  const logicalWireLength = routeLengthFromEdges(graph.edges || []);
  const uniqueWireLength = routeLengthFromRoutes(wireRoutes);
  const wireSegmentCount = wireRoutes.reduce((count, route) => count + (route.segments?.length || 0), 0);
  const junctionCount = wireRoutes.reduce((count, route) => count + (route.junctions?.length || 0), 0);
  const treeRouteCount = wireRoutes.filter((route) => route.topology === "tree").length;
  const forestRouteCount = wireRoutes.filter((route) => route.topology === "forest").length;
  const treeFallbackCount = wireRoutes.filter((route) => route.treeFallback === true).length;
  const cycleCount = wireRoutes.reduce((count, route) => count + (Number(route.cycleCount) || 0), 0);
  const eliminatedDuplicateLength = Math.max(0, logicalWireLength - uniqueWireLength);
  const renderedDuplicateLength = wireRoutes.reduce(
    (total, route) => total + overlappingSegmentLength(route.segments || []),
    0
  );
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
    outerRouteCount,
    outerRouteRatio: ratio(outerRouteCount, edgeCount),
    routeKinds,
    routeStrategies,
    wireRouteCount: wireRoutes.length,
    wireSegmentCount,
    junctionCount,
    treeRouteCount,
    forestRouteCount,
    treeFallbackCount,
    cycleCount,
    logicalWireLength: round(logicalWireLength),
    uniqueWireLength: round(uniqueWireLength),
    eliminatedDuplicateLength: round(eliminatedDuplicateLength),
    renderedDuplicateLength: round(renderedDuplicateLength)
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
    "hiddenLabelCount",
    "outerRouteCount",
    "outerRouteRatio",
    "wireRouteCount",
    "wireSegmentCount",
    "junctionCount",
    "treeRouteCount",
    "forestRouteCount",
    "treeFallbackCount",
    "cycleCount",
    "logicalWireLength",
    "uniqueWireLength",
    "eliminatedDuplicateLength",
    "renderedDuplicateLength"
  ];
  return {
    base,
    candidate,
    delta: Object.fromEntries(keys.map((key) => [key, round(candidate[key] - base[key])]))
  };
}

function isOuterRoute(edge) {
  return edge.routeStrategy === "outer-lane" ||
    edge.routeKind === "obstacle-lane" ||
    edge.routeKind === "top-lane";
}

function countLayoutConflicts(edges) {
  const index = new RouteSegmentIndex();
  let crossings = 0;
  let overlaps = 0;
  for (const edge of edges) {
    for (const segment of getRouteSegments(edge.points || [], edge.net)) {
      for (const existing of index.querySegment(segment, MINIMUM_FOREIGN_WIRE_SEPARATION)) {
        if (existing.net === segment.net) continue;
        if (collinearSegmentsOverlap(existing, segment) ||
          parallelSegmentsOverlap(existing, segment)) {
          overlaps += 1;
        } else if (segmentsConflict(existing, segment)) {
          crossings += 1;
        }
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

function routeLengthFromEdges(edges) {
  return edges.reduce((total, edge) => total + routeLength(edge.points || []), 0);
}

function routeLengthFromRoutes(routes) {
  return routes.reduce((total, route) => total + (route.segments || [])
    .reduce((length, segment) => length + manhattanDistance(segment.start, segment.end), 0), 0);
}

function overlappingSegmentLength(segments) {
  let length = 0;
  for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < segments.length; rightIndex += 1) {
      const left = segments[leftIndex];
      const right = segments[rightIndex];
      const horizontal = near(left.start.y, left.end.y) && near(right.start.y, right.end.y) &&
        near(left.start.y, right.start.y);
      const vertical = near(left.start.x, left.end.x) && near(right.start.x, right.end.x) &&
        near(left.start.x, right.start.x);
      if (!horizontal && !vertical) continue;
      const leftMinimum = horizontal
        ? Math.min(left.start.x, left.end.x)
        : Math.min(left.start.y, left.end.y);
      const leftMaximum = horizontal
        ? Math.max(left.start.x, left.end.x)
        : Math.max(left.start.y, left.end.y);
      const rightMinimum = horizontal
        ? Math.min(right.start.x, right.end.x)
        : Math.min(right.start.y, right.end.y);
      const rightMaximum = horizontal
        ? Math.max(right.start.x, right.end.x)
        : Math.max(right.start.y, right.end.y);
      length += Math.max(0, Math.min(leftMaximum, rightMaximum) -
        Math.max(leftMinimum, rightMinimum));
    }
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
