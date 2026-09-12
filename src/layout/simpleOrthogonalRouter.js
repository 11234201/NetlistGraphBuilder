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
    routingGeometry,
    margin
  } = options;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const nodeIndex = createNodeSpatialIndex(nodes);
  const nodeBounds = computeNodeCollectionBox(nodes);
  const levelBounds = computeLevelBounds(nodes);
  const globalLaneGeometry = prepareGlobalLaneGeometry(
    nodes,
    Number(routingGeometry?.outerLaneClearance) || 24
  );
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
    routeKinds: Object.create(null),
    capacity: routingCapacity?.metrics
      ? {
        physicalNetCount: routingCapacity.metrics.physicalNetCount,
        channelCount: routingCapacity.metrics.channelCount,
        allocatedLaneCount: routingCapacity.metrics.allocatedLaneCount,
        expandedChannelCount: routingCapacity.metrics.expandedChannelCount,
        boundaryClusterCount: routingCapacity.metrics.boundaryClusterCount,
        maximumBoundaryClusterDemand: routingCapacity.metrics.maximumBoundaryClusterDemand,
        topWireHeadroom: routingCapacity.metrics.topWireHeadroom
      }
      : null
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
      getNetGroupKey(edge),
      {
        sourceLevel: source.level,
        targetLevel: target.level,
        sourceNodeId: source.id,
        targetNodeId: target.id
      }
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
      routingGeometry,
      margin,
      edgeIntent,
      reservedSegments,
      globalLaneGeometry,
      routingMetrics,
      strictRouting: options.strictRouting === true,
      net: edge.net,
      netGroupKey: getNetGroupKey(edge)
    });
    const label = getLabelPlacement(edge, source, target, sourcePoint, targetPoint);
    const positionedEdge = {
      ...edge,
      points: routed.points,
      routeKind: routed.kind,
      routeStatus: routed.status || "routed",
      routeDiagnostics: routed.diagnostics,
      capacityChannelId: edgePlan?.capacityChannelId,
      capacityBoundaryClusterKey: edgePlan?.capacityBoundaryClusterKey,
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
          routeKinds: { ...routingMetrics.routeKinds },
          capacity: routingMetrics.capacity ? { ...routingMetrics.capacity } : null
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

function applyCapacityLane(edgePlan, routingCapacity, netGroupKey, edgeContext = {}) {
  if (!routingCapacity?.allocationByNet) return edgePlan;
  const assignments = routingCapacity.allocationByNet.get(netGroupKey) || [];
  const topAssignment = assignments.find((assignment) => assignment.channelId === "outer-top");
  const localAssignments = assignments.filter((assignment) =>
    String(assignment.channelId).startsWith("inter-layer:"));
  const sourceBoundaryId = getSourceBoundaryChannelId(
    edgeContext.sourceLevel,
    edgeContext.targetLevel
  );
  const localAssignment = localAssignments.find((assignment) =>
    assignment.channelId === sourceBoundaryId) || localAssignments[0];
  const rowGapAssignments = assignments
    .filter((assignment) => String(assignment.channelId).startsWith("row-gap:"))
    .toSorted((left, right) => String(left.channelId).localeCompare(String(right.channelId)));
  if (!topAssignment && !localAssignment && rowGapAssignments.length === 0) return edgePlan;
  const selectedAssignment = localAssignment || topAssignment || rowGapAssignments[0];
  return {
    ...(edgePlan || {}),
    ...(topAssignment ? {
      topLane: topAssignment.laneIndex,
      capacityChannelId: topAssignment.channelId,
      capacityBoundaryClusterKey: topAssignment.boundaryClusterKey
    } : {}),
    // Row-gap lanes are recorded for diagnostics and future edge-specific
    // corridor selection.  A single edge may cross several row gaps, so
    // blindly choosing the lexically first row coordinate would change route
    // shape for unrelated focused branches.  Inter-layer/outer assignments
    // remain the only global preference until a route has a matching level.
    preferredLaneY: localAssignment?.coordinate ?? topAssignment?.coordinate,
    capacityBoundaryClusterKey: selectedAssignment?.boundaryClusterKey,
    capacityCorridor: selectedAssignment ? {
      channelId: selectedAssignment.channelId,
      boundaryClusterKey: selectedAssignment.boundaryClusterKey,
      coordinate: selectedAssignment.coordinate,
      intervalStart: selectedAssignment.intervalStart,
      intervalEnd: selectedAssignment.intervalEnd,
      sourceEscapeSide: selectedAssignment.sourceEscapeSide,
      targetEscapeSides: selectedAssignment.targetEscapeSides,
      sourceEscapeInterval: selectedAssignment.sourceEscapeInterval,
      targetEscapeRanges: selectedAssignment.targetEscapeRanges
    } : undefined,
    capacityEscape: localAssignment
      ? {
        sourceEscapeSide: localAssignment.sourceEscapeSide,
        targetEscapeSides: localAssignment.targetEscapeSides
      }
      : undefined,
    rowGapLanes: rowGapAssignments.map((assignment) => ({
      channelId: assignment.channelId,
      coordinate: assignment.coordinate,
      laneIndex: assignment.laneIndex,
      boundaryClusterKey: assignment.boundaryClusterKey
    }))
  };
}

/**
 * Bind a skip-level edge to the first boundary it actually leaves from.
 * Capacity is allocated once per physical net and boundary; choosing the
 * source-adjacent assignment avoids letting lexical boundary order decide
 * the preferred y lane for long or reverse edges.  The fallback keeps the
 * pre-existing behavior for incomplete synthetic plans.
 */
function getSourceBoundaryChannelId(sourceLevel, targetLevel) {
  const source = Number(sourceLevel);
  const target = Number(targetLevel);
  if (!Number.isFinite(source) || !Number.isFinite(target) || source === target) return null;
  const boundaryLevel = source < target ? source : target;
  return `inter-layer:${boundaryLevel}->${boundaryLevel + 1}`;
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
  const conflictFreeBasic = scoredBasic.filter(({ candidate, score }) =>
    score.crossings === 0 && !routeOverlapsReserved(
      candidate.points,
      net,
      reservedSegments,
      netGroupKey
    ));
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
  const conflictFreeReservedDetours = scoredReservedDetours.filter(({ candidate, score }) =>
    score.crossings === 0 && !routeOverlapsReserved(
      candidate.points,
      net,
      reservedSegments,
      netGroupKey
    ));
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
  const conflictFreeExpandedLocal = scoredExpandedLocal.filter(({ candidate, score }) =>
    score.crossings === 0 && !routeOverlapsReserved(
      candidate.points,
      net,
      reservedSegments,
      netGroupKey
    ));
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
    if (!localHasOverlap && (context.strictRouting === true ||
      bestLocalScore.crossings <= ROUTE_SELECTION_POLICY.maximumAdditionalLocalCrossings)) {
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
      const globalIsHardUsable = !context.strictRouting || isHardRouteCandidate(globalCandidate, context);
      const removesHardOverlap = localHasOverlap && !globalHasOverlap;
      if (globalIsHardUsable && (removesHardOverlap || (!avoidsLargeOuterDetour && (
        globalScore.crossings < bestLocalScore.crossings ||
        (globalScore.crossings === bestLocalScore.crossings &&
          globalScore.total < bestLocalScore.total))))) {
        return globalCandidate;
      }
    }
    if (context.strictRouting === true) {
      return createUnroutableRoute(context, {
        candidateCount: scoredCandidates.length,
        localOverlap: localHasOverlap,
        localCrossings: bestLocalScore.crossings
      });
    }
    return bestLocal;
  }

  routingMetrics.globalFallbacks += 1;
  const globalFallback = createGlobalFallback(context);
  if (context.strictRouting === true && !isHardRouteCandidate(globalFallback, context)) {
    return createUnroutableRoute(context, { candidateCount: 0 });
  }
  return globalFallback;
}

function isHardRouteCandidate(candidate, context) {
  return Boolean(candidate?.points?.length >= 2) &&
    candidateIsUsable(candidate, context) &&
    !routeOverlapsReserved(
      candidate.points,
      context.net,
      context.reservedSegments,
      context.netGroupKey
    );
}

function createUnroutableRoute(context, details = {}) {
  return {
    kind: "unroutable",
    status: "unroutable",
    points: [],
    diagnostics: [{
      code: "simple-route-unroutable",
      sourceNodeId: context.source?.id,
      targetNodeId: context.target?.id,
      netGroupKey: context.netGroupKey,
      ...details
    }]
  };
}

function findReservationFreeLaneShift(candidate, context) {
  const points = candidate?.points || [];
  const laneY = findInteriorHorizontalLaneY(points);
  if (!Number.isFinite(laneY)) return null;
  const pitch = Math.max(4, Number(context.wireLanePitch) || 24);
  const horizontalOffsets = [pitch, -pitch, pitch * 2, -pitch * 2, pitch * 3, -pitch * 3];
  const verticalOffsets = [0, pitch, -pitch, pitch * 2, -pitch * 2];
  const sourceLaneX = points.length > 2 ? points[1].x : null;
  const targetLaneX = points.length > 3 ? points.at(-2).x : null;
  const shiftPlans = [
    ...verticalOffsets.flatMap((sourceOffset) => [
      { source: sourceOffset, target: 0 },
      { source: 0, target: sourceOffset }
    ]),
    { source: pitch, target: pitch },
    { source: -pitch, target: -pitch }
  ];
  for (const offset of horizontalOffsets) {
    for (const shift of shiftPlans) {
      const shiftedPoints = points.map((point, index) => {
        if (index === 0 || index === points.length - 1) return point;
        const next = Math.abs(point.y - laneY) < 0.5
          ? { ...point, y: point.y + offset }
          : { ...point };
        if (sourceLaneX !== null && Math.abs(point.x - sourceLaneX) < 0.5 && index <= 2) {
          next.x += shift.source;
        }
        if (targetLaneX !== null && Math.abs(point.x - targetLaneX) < 0.5 && index >= points.length - 3) {
          next.x += shift.target;
        }
        return next;
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
      )) {
        return shifted;
      }
    }
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
  const plannedLaneY = context.edgePlan?.kind === "long" &&
    (context.source?.kind === "group" || context.target?.kind === "group")
    ? Number(context.edgePlan?.preferredLaneY)
    : NaN;
  return findObstacleAvoidingRoute({
    source: context.source,
    target: context.target,
    sourcePoint: context.sourcePoint,
    targetPoint: context.targetPoint,
    nodes: context.nodes,
    // A source-adjacent inter-layer/row-gap assignment is the route's first
    // horizontal corridor.  Fall back to the bounded outer lane only when the
    // plan has no geometry-aware coordinate (legacy/synthetic plans).
    preferredLaneY: Number.isFinite(plannedLaneY)
      ? plannedLaneY
      : context.margin / 2 +
        (context.edgePlan?.topLane || 0) * context.topWireLanePitch,
    margin: context.margin,
    lanePitch: context.topWireLanePitch,
    nodeIndex: context.nodeIndex,
    globalLaneGeometry: context.globalLaneGeometry,
    reservedSegments: context.reservedSegments,
    net: context.net,
    netGroupKey: context.netGroupKey,
    routingGeometry: context.routingGeometry
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
