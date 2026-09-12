import { compareEdgesByLayoutPriority } from "./layoutIntent.js";
import { getConnectionPoint } from "./nodeGeometry.js";
import { compactOrthogonalPoints } from "./orthogonalRouting.js";
import { countRouteConflicts, getRouteSegments } from "./orthogonalRouting.js";
import { getNetGroupKey } from "./layoutTopology.js";
import {
  routeCandidateIsUsable,
  routeOverlapsReserved
} from "./routeCandidateValidation.js";
import { scoreRouteCandidate } from "./routeScoring.js";
import { ROUTE_SELECTION_POLICY } from "./routeSearchPolicy.js";
import {
  computeLevelBounds,
  createBasicSimpleRouteCandidates,
  createLocalObstacleCandidates,
  findObstacleAvoidingRoute,
  prepareGlobalLaneGeometry
} from "./simpleRouteCandidates.js";
import {
  computeNodeCollectionBox,
  createNodeSpatialIndex,
  RouteSegmentIndex
} from "./spatialIndex.js";
import { placeWireLabels } from "./wireLabelPlacement.js";

const MAX_SCORED_ROUTE_CONFLICTS = 8;

export function routeSimpleEdges(graph, nodes, options) {
  const {
    layoutIntent,
    routePlan,
    routingCapacity,
    wireLanePitch,
    topWireLanePitch,
    margin
  } = options;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const nodeIndex = createNodeSpatialIndex(nodes);
  const nodeBounds = computeNodeCollectionBox(nodes);
  const levelBounds = computeLevelBounds(nodes);
  const globalLaneGeometry = prepareGlobalLaneGeometry(nodes, 24);
  const routedById = new Map();
  const reservedSegments = new RouteSegmentIndex();
  const orderedEdges = graph.edges.toSorted((left, right) =>
    compareEdgesByLayoutPriority(left, right, layoutIntent));
  const startedAt = now();
  const routingMetrics = {
    basicCandidates: 0,
    localFallbacks: 0,
    localCandidates: 0,
    globalFallbacks: 0,
    routeKinds: Object.create(null)
  };

  for (const [edgeIndex, edge] of orderedEdges.entries()) {
    const edgeIntent = layoutIntent.getEdge(edge);
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) continue;
    const sourcePoint = getConnectionPoint(source, edge.sourcePin, "source");
    const targetPoint = getConnectionPoint(target, edge.targetPin, "target");
    const edgePlan = applyCapacityLane(
      routePlan.edges.get(edge.id),
      routingCapacity,
      getNetGroupKey(edge)
    );
    const routed = routeEdge({
      source,
      target,
      sourcePoint,
      targetPoint,
      edgePlan,
      levelBounds,
      nodes,
      nodeIndex,
      nodeBounds,
      wireLanePitch,
      topWireLanePitch,
      margin,
      edgeIntent,
      reservedSegments,
      globalLaneGeometry,
      routingMetrics,
      net: edge.net,
      netGroupKey: getNetGroupKey(edge)
    });
    const label = getLabelPlacement(edge, source, target, sourcePoint, targetPoint);
    const positionedEdge = {
      ...edge,
      points: routed.points,
      routeKind: routed.kind,
      labelPoint: label.point,
      labelAnchor: label.anchor
    };
    routedById.set(edge.id, positionedEdge);
    routingMetrics.routeKinds[routed.kind] =
      (routingMetrics.routeKinds[routed.kind] || 0) + 1;
    reservedSegments.pushUnique(...getOwnedRouteSegments(positionedEdge.points, edge));
    if (options.onRoutingProgress &&
      ((edgeIndex + 1) % 256 === 0 || edgeIndex + 1 === orderedEdges.length)) {
      options.onRoutingProgress({
        completedEdges: edgeIndex + 1,
        totalEdges: orderedEdges.length,
        reservedSegments: reservedSegments.length,
        metrics: {
          ...routingMetrics,
          routeKinds: { ...routingMetrics.routeKinds }
        }
      });
    }
  }

  const routedEdges = graph.edges.map((edge) => routedById.get(edge.id) || edge);
  options.onRoutingStage?.("labels-start");
  const labeledEdges = placeWireLabels(routedEdges, nodes, {
    preferExisting: true,
    compareEdges: (left, right) => compareEdgesByLayoutPriority(left, right, layoutIntent)
  });
  options.onRoutingStage?.("labels-complete");
  routingMetrics.elapsedMs = Math.round(now() - startedAt);
  routingMetrics.physicalNetCount = new Set(graph.edges.map(getNetGroupKey)).size;
  routingMetrics.reservedSegments = reservedSegments.metrics;
  Object.defineProperty(labeledEdges, "routingMetrics", {
    value: Object.freeze({
      ...routingMetrics,
      routeKinds: Object.freeze({ ...routingMetrics.routeKinds }),
      reservedSegments: Object.freeze({ ...routingMetrics.reservedSegments })
    }),
    enumerable: false
  });
  return labeledEdges;
}

function applyCapacityLane(edgePlan, routingCapacity, netGroupKey) {
  if (!routingCapacity?.allocationByNet) return edgePlan;
  const assignments = routingCapacity.allocationByNet.get(netGroupKey) || [];
  const topAssignment = assignments.find((assignment) => assignment.channelId === "outer-top");
  const localAssignment = assignments.find((assignment) =>
    String(assignment.channelId).startsWith("inter-layer:"));
  if (!topAssignment && !localAssignment) return edgePlan;
  return {
    ...(edgePlan || {}),
    ...(topAssignment ? {
      topLane: topAssignment.laneIndex,
      capacityChannelId: topAssignment.channelId
    } : {}),
    preferredLaneY: localAssignment?.coordinate ?? topAssignment?.coordinate
  };
}

function getOwnedRouteSegments(points, edge) {
  const physicalOwner = getNetGroupKey(edge);
  return getRouteSegments(points, edge.net, physicalOwner).map((segment) => ({
    ...segment,
    physicalOwner,
    netGroupKey: physicalOwner
  }));
}

function routeEdge(context) {
  const {
    source,
    target,
    sourcePoint,
    targetPoint,
    edgePlan,
    nodes,
    nodeIndex,
    topWireLanePitch,
    margin,
    edgeIntent,
    reservedSegments,
    routingMetrics,
    net,
    netGroupKey = undefined
  } = context;
  const candidates = createBasicSimpleRouteCandidates(context);
  const basicCandidates = candidates.filter((candidate) =>
    candidateIsUsable(candidate, context));
  routingMetrics.basicCandidates += basicCandidates.length;
  const scoredBasic = scoreCandidates(basicCandidates, reservedSegments, net, netGroupKey, edgeIntent);
  const conflictFreeBasic = scoredBasic.filter(({ score }) => score.crossings === 0);
  if (conflictFreeBasic.length > 0) {
    return chooseBestScoredRoute(conflictFreeBasic);
  }

  routingMetrics.localFallbacks += 1;
  const localCandidates = createLocalObstacleCandidates(context);
  routingMetrics.localCandidates += localCandidates.length;
  const usableLocalCandidates = [];
  for (const candidate of localCandidates) {
    if (!candidateIsUsable(candidate, context)) continue;
    usableLocalCandidates.push(candidate);
    if (countRouteConflicts(candidate.points, reservedSegments, net, 1, netGroupKey) === 0) {
      return candidate;
    }
  }
  const reservedDetours = createLocalObstacleCandidates(context, { reservedDetours: true });
  const usableReservedDetours = reservedDetours.filter((candidate) =>
    candidateIsUsable(candidate, context));
  const scoredReservedDetours = scoreCandidates(
    usableReservedDetours,
    reservedSegments,
    net,
    netGroupKey,
    edgeIntent
  );
  const conflictFreeReservedDetours = scoredReservedDetours.filter(({ score }) => score.crossings === 0);
  if (conflictFreeReservedDetours.length > 0) {
    return chooseBestScoredRoute(conflictFreeReservedDetours);
  }
  // Cell spacing can expose clear horizontal corridors while the default
  // local vertical escape line is still blocked by a nearby boundary node.
  // Try a bounded set of small x shifts before escalating to a graph-wide
  // outer lane, which otherwise produces a large rectangular detour.
  const expandedLocalCandidates = basicCandidates.length === 0 &&
    source.kind === "focus-input" &&
    edgeIntent?.fanout > 1 &&
    edgeIntent.isPrimary === false
    ? createLocalObstacleCandidates(context, { expandXLanes: true })
    : [];
  routingMetrics.localCandidates += expandedLocalCandidates.length;
  const usableExpandedLocalCandidates = expandedLocalCandidates.filter((candidate) =>
    candidateIsUsable(candidate, context));
  const scoredExpandedLocal = scoreCandidates(
    usableExpandedLocalCandidates,
    reservedSegments,
    net,
    netGroupKey,
    edgeIntent
  );
  const conflictFreeExpandedLocal = scoredExpandedLocal.filter(({ score }) => score.crossings === 0);
  if (conflictFreeExpandedLocal.length > 0) {
    return chooseBestScoredRoute(conflictFreeExpandedLocal);
  }
  const scoredCandidates = [
    ...scoredBasic,
    ...scoreCandidates(usableLocalCandidates, reservedSegments, net, netGroupKey, edgeIntent),
    ...scoredReservedDetours,
    ...scoredExpandedLocal
  ];
  if (scoredCandidates.length > 0) {
    // Collinear overlap is a hard routing error. Prefer a clear local route
    // even when it crosses a few perpendicular wires; crossings receive
    // bridges in the renderer and remain a soft visual cost.
    const nonOverlappingLocalCandidates = scoredCandidates.filter(({ candidate }) =>
      !routeOverlapsReserved(candidate.points, net, reservedSegments, netGroupKey));
    const bestLocal = chooseBestScoredRoute(
      nonOverlappingLocalCandidates.length > 0
        ? nonOverlappingLocalCandidates
        : scoredCandidates
    );
    const bestLocalScore = scoreRouteCandidate(bestLocal, {
      reservedSegments,
      net,
      netGroupKey,
      edgeIntent
    });
    const localHasOverlap = routeOverlapsReserved(bestLocal.points, net, reservedSegments, netGroupKey);
    if (localHasOverlap) {
      const repaired = findReservationFreeLaneShift(bestLocal, context);
      if (repaired) return repaired;
    }
    if (!localHasOverlap && bestLocalScore.crossings <= ROUTE_SELECTION_POLICY.maximumAdditionalLocalCrossings) {
      return bestLocal;
    }
    // A usable local path may still overlap a previously routed net when all
    // of its target-side lanes are occupied. Give the bounded global search a
    // chance to remove that conflict before accepting the scored fallback.
    if (bestLocalScore.crossings > 0) {
      routingMetrics.globalFallbacks += 1;
      const globalCandidate = createGlobalFallback(context);
      const globalScore = scoreRouteCandidate(globalCandidate, {
        reservedSegments,
        net,
        netGroupKey,
        edgeIntent
      });
      const globalHasOverlap = routeOverlapsReserved(globalCandidate.points, net, reservedSegments, netGroupKey);
      const avoidsLargeOuterDetour = !localHasOverlap &&
        globalScore.length - bestLocalScore.length >= Math.max(
          ROUTE_SELECTION_POLICY.minimumOuterDetourSavings,
          (Number(context.wireLanePitch) || 24) *
            ROUTE_SELECTION_POLICY.outerDetourWirePitchMultiplier
        ) &&
        bestLocalScore.crossings - globalScore.crossings <=
          ROUTE_SELECTION_POLICY.maximumAdditionalLocalCrossings;
      if (!avoidsLargeOuterDetour && ((localHasOverlap && !globalHasOverlap) ||
        globalScore.crossings < bestLocalScore.crossings ||
        (globalScore.crossings === bestLocalScore.crossings &&
          globalScore.total < bestLocalScore.total))) {
        return globalCandidate;
      }
    }
    return bestLocal;
  }

  routingMetrics.globalFallbacks += 1;
  return createGlobalFallback(context);
}

function findReservationFreeLaneShift(candidate, context) {
  const points = candidate?.points || [];
  const laneY = findInteriorHorizontalLaneY(points);
  if (!Number.isFinite(laneY)) return null;
  const pitch = Math.max(4, Number(context.wireLanePitch) || 24);
  const offsets = [pitch, -pitch, pitch * 2, -pitch * 2, pitch * 3, -pitch * 3];
  for (const offset of offsets) {
    const shiftedPoints = points.map((point, index) => {
      if (index === 0 || index === points.length - 1) return point;
      return Math.abs(point.y - laneY) < 0.5
        ? { ...point, y: point.y + offset }
        : point;
    });
    const shifted = {
      ...candidate,
      kind: `${candidate.kind}-lane-shift`,
      points: compactOrthogonalPoints(shiftedPoints)
    };
    if (!candidateIsUsable(shifted, context)) continue;
    if (!routeOverlapsReserved(
      shifted.points,
      context.net,
      context.reservedSegments,
      context.netGroupKey
    )) return shifted;
  }
  return null;
}

function findInteriorHorizontalLaneY(points) {
  let laneY = null;
  let longest = 0;
  for (let index = 1; index < points.length - 2; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (Math.abs(start.y - end.y) >= 0.5) continue;
    const length = Math.abs(start.x - end.x);
    if (length > longest) {
      longest = length;
      laneY = start.y;
    }
  }
  return laneY;
}

function createGlobalFallback(context) {
  return findObstacleAvoidingRoute({
    source: context.source,
    target: context.target,
    sourcePoint: context.sourcePoint,
    targetPoint: context.targetPoint,
    nodes: context.nodes,
    preferredLaneY: context.margin / 2 +
      (context.edgePlan?.topLane || 0) * context.topWireLanePitch,
    margin: context.margin,
    lanePitch: context.topWireLanePitch,
    nodeIndex: context.nodeIndex,
    globalLaneGeometry: context.globalLaneGeometry,
    reservedSegments: context.reservedSegments,
    net: context.net,
    netGroupKey: context.netGroupKey
  });
}

function candidateIsUsable(candidate, context) {
  return routeCandidateIsUsable(candidate.points, {
    source: context.source,
    target: context.target,
    sourcePoint: context.sourcePoint,
    targetPoint: context.targetPoint,
    nodeIndex: context.nodeIndex,
    net: context.net,
    netGroupKey: context.netGroupKey,
    reservedSegments: context.reservedSegments
  }, {
    nodePadding: context.source?.kind === "cell" && context.target?.kind === "cell" ? 0 : undefined,
    allowNodePaddingBoundary: true
  });
}

function scoreCandidates(candidates, reservedSegments, net, netGroupKey, edgeIntent) {
  const context = {
    reservedSegments,
    net,
    netGroupKey,
    edgeIntent,
    maximumCrossings: MAX_SCORED_ROUTE_CONFLICTS
  };
  return candidates.map((candidate) => ({
    candidate,
    score: scoreRouteCandidate(candidate, context)
  }));
}

function chooseBestScoredRoute(scoredCandidates) {
  let best = scoredCandidates[0];
  for (let index = 1; index < scoredCandidates.length; index += 1) {
    const candidate = scoredCandidates[index];
    if (compareRouteScores(candidate.score, best.score) < 0) best = candidate;
  }
  return best?.candidate;
}

function compareRouteScores(left, right) {
  return left.total - right.total ||
    left.crossings - right.crossings ||
    left.bends - right.bends ||
    left.length - right.length;
}

function getLabelPlacement(edge, source, target, sourcePoint, targetPoint) {
  const labelWidth = Math.min(96, Math.max(28, String(edge.label || "").length * 6));
  if (target.kind === "cell" || target.kind === "assign" ||
    target.kind === "output" || target.kind === "focus-output") {
    return {
      point: { x: targetPoint.x - labelWidth - 8, y: targetPoint.y - 6 },
      anchor: "start"
    };
  }
  return { point: { x: sourcePoint.x + 8, y: sourcePoint.y - 6 }, anchor: "start" };
}

function now() {
  return typeof globalThis.performance?.now === "function"
    ? globalThis.performance.now()
    : Date.now();
}
