import { compareEdgesByLayoutPriority } from "./layoutIntent.js";
import { getConnectionPoint } from "./nodeGeometry.js";
import { compactOrthogonalPoints } from "./orthogonalRouting.js";
import { countRouteConflicts, getRouteSegments } from "./orthogonalRouting.js";
import { getTargetApproachPoint, isVerticalTargetPin } from "./orthogonalRouting.js";
import { getNetGroupKey } from "./layoutTopology.js";
import {
  routeCandidateIsUsable,
  routeOverlapsReserved,
  isTargetEntryVisuallyClear
} from "./routeCandidateValidation.js";
import { scoreRouteCandidate } from "./routeScoring.js";
import {
  computeLevelBounds,
  createBasicSimpleRouteCandidates,
  createLocalObstacleCandidates,
  findObstacleAvoidingRoute,
  getEscapeLaneX,
  prepareGlobalLaneGeometry
} from "./simpleRouteCandidates.js";
import {
  computeNodeCollectionBox,
  createNodeSpatialIndex,
  RouteSegmentIndex
} from "./spatialIndex.js";
import { placeWireLabels } from "./wireLabelPlacement.js";
import { validatePhysicalNetCommit } from "./physical_net_commit.js";

const MAX_SCORED_ROUTE_CONFLICTS = 8;
const MAX_CAPACITY_LANE_Y_HINTS = 24;

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
  // Target-entry spacing is only needed when the provider is rendering a
  // Focused cone. Whole-graph routing has no focused target boundary and
  // should pay zero map/registration cost for this visual guard.
  const targetEntryLanes = nodes.some((node) => node.isFocusedRoot === true)
    ? new Map()
    : null;
  const unroutablePhysicalNets = new Set();
  const overflowUnroutablePhysicalNets = new Set();
  const orderedEdges = graph.edges.toSorted((left, right) =>
    compareEdgesByLayoutPriority(left, right, layoutIntent));
  const edgesByPhysicalNet = groupEdgesByPhysicalNet(orderedEdges);
  const attemptedPhysicalNets = new Set();
  const startedAt = now();
  const routingMetrics = {
    basicCandidates: 0,
    localFallbacks: 0,
    localCandidates: 0,
    globalFallbacks: 0,
    routeKinds: Object.create(null),
    carrierCandidatePhysicalNetCount: options.carrierRoutesByPhysicalNet?.size || 0,
    carrierRoutingSummary: options.carrierRoutingSummary || null,
    capacity: routingCapacity?.metrics
      ? {
        physicalNetCount: routingCapacity.metrics.physicalNetCount,
        channelCount: routingCapacity.metrics.channelCount,
        allocatedLaneCount: routingCapacity.metrics.allocatedLaneCount,
        expandedChannelCount: routingCapacity.metrics.expandedChannelCount,
        overflowChannelCount: routingCapacity.metrics.overflowChannelCount,
        overflowDemandCount: routingCapacity.metrics.overflowDemandCount,
        overflowPhysicalNetCount: routingCapacity.metrics.overflowPhysicalNetCount,
        allocatorOverflowPhysicalNetCount: routingCapacity.metrics.allocatorOverflowPhysicalNetCount,
        placementOverflowDemandCount: routingCapacity.metrics.placementOverflowDemandCount,
        placementOverflowPhysicalNetCount: routingCapacity.metrics.placementOverflowPhysicalNetCount,
        boundaryClusterCount: routingCapacity.metrics.boundaryClusterCount,
        maximumBoundaryClusterDemand: routingCapacity.metrics.maximumBoundaryClusterDemand,
        topWireHeadroom: routingCapacity.metrics.topWireHeadroom
      }
      : null
  };

  for (const [groupIndex, [physicalNetKey, physicalNetEdges]] of [...edgesByPhysicalNet]
    .filter(([, edges]) => edges.length >= 2 &&
      nodeById.get(edges[0]?.source)?.kind === "focus-input")
    .toSorted((left, right) => compareFocusedPhysicalNetDifficulty(
      left,
      right,
      nodeById
    )).entries()) {
    const source = nodeById.get(physicalNetEdges[0]?.source);
    const groupContext = {
      nodeById,
      nodes,
      nodeIndex,
      nodeBounds,
      levelBounds,
      globalLaneGeometry,
      reservedSegments,
      routePlan,
      routingCapacity,
      routingGeometry,
      layoutIntent,
      wireLanePitch,
      topWireLanePitch,
      margin,
      targetEntryLanes,
      strictRouting: options.strictRouting === true,
      routingMetrics,
      trunkBias: groupIndex % 2 === 0 ? -1 : 1
    };
    const alignedTree = tryRoutePhysicalNetGroup(physicalNetEdges, groupContext) ||
      tryRoutePhysicalNetGroupWithCandidates(physicalNetEdges, groupContext);
    if (!alignedTree) continue;
    attemptedPhysicalNets.add(physicalNetKey);
    routingMetrics.alignedPhysicalNetTreeCount =
      (routingMetrics.alignedPhysicalNetTreeCount || 0) + 1;
    commitPhysicalNetRoutes(alignedTree, {
      routedById,
      reservedSegments,
      routingMetrics,
      unroutablePhysicalNets,
      overflowUnroutablePhysicalNets,
      nodeById,
      targetEntryLanes
    });
  }

  for (const [physicalNetKey, candidates] of [...(options.carrierRoutesByPhysicalNet || new Map())]
    .toSorted(([left], [right]) => String(left).localeCompare(String(right)))) {
    const physicalNetEdges = edgesByPhysicalNet.get(physicalNetKey) || [];
    const preferredCarrierRoutes = tryCarrierPhysicalNetGroup(
      physicalNetEdges,
      candidates,
      { nodes, nodeIndex, reservedSegments }
    );
    if (!preferredCarrierRoutes) continue;
    attemptedPhysicalNets.add(physicalNetKey);
    routingMetrics.carrierPhysicalNetTreeCount =
      (routingMetrics.carrierPhysicalNetTreeCount || 0) + 1;
    commitPhysicalNetRoutes(preferredCarrierRoutes, {
      routedById,
      reservedSegments,
      routingMetrics,
      unroutablePhysicalNets,
      overflowUnroutablePhysicalNets,
      nodeById,
      targetEntryLanes
    });
  }

  for (const [edgeIndex, edge] of orderedEdges.entries()) {
    if (routedById.has(edge.id)) continue;
    const edgeIntent = layoutIntent.getEdge(edge);
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) continue;
    const sourcePoint = getConnectionPoint(source, edge.sourcePin, "source");
    const targetPoint = getConnectionPoint(target, edge.targetPin, "target");
    const physicalNetKey = getNetGroupKey(edge);
    if (!attemptedPhysicalNets.has(physicalNetKey)) {
      attemptedPhysicalNets.add(physicalNetKey);
      const physicalNetEdges = edgesByPhysicalNet.get(physicalNetKey) || [];
      options.onRoutingGroup?.({
        phase: "start",
        edgeIndex,
        physicalNetKey,
        edgeCount: physicalNetEdges.length
      });
      const capacityBlockedRoutes = tryRouteCapacityBlockedPhysicalNetGroup(
        physicalNetEdges,
        {
          nodeById,
          nodes,
          nodeIndex,
          levelBounds,
          reservedSegments,
          routePlan,
          routingCapacity,
          routingGeometry,
          layoutIntent,
          wireLanePitch,
          topWireLanePitch,
          margin,
          targetEntryLanes
        }
      );
      options.onRoutingGroup?.({ phase: "capacity-tried", edgeIndex, physicalNetKey, edgeCount: physicalNetEdges.length });
      if (capacityBlockedRoutes) {
        options.onRoutingGroup?.({
          phase: "capacity-complete",
          edgeIndex,
          physicalNetKey,
          edgeCount: physicalNetEdges.length
        });
        commitPhysicalNetRoutes(capacityBlockedRoutes, {
          routedById,
          reservedSegments,
          routingMetrics,
          unroutablePhysicalNets,
          overflowUnroutablePhysicalNets,
          nodeById,
          targetEntryLanes
        });
        continue;
      }
      const atomicRoutes = tryRoutePhysicalNetGroup(
        physicalNetEdges,
        {
          nodeById,
          nodes,
          nodeIndex,
          reservedSegments,
          routePlan,
          routingCapacity,
          routingGeometry,
          layoutIntent,
          routingMetrics,
          targetEntryLanes
        }
      );
      options.onRoutingGroup?.({ phase: "atomic-tried", edgeIndex, physicalNetKey, edgeCount: physicalNetEdges.length });
      if (atomicRoutes) {
        options.onRoutingGroup?.({
          phase: "atomic-complete",
          edgeIndex,
          physicalNetKey,
          edgeCount: physicalNetEdges.length
        });
        routingMetrics.atomicPhysicalNetTreeCount =
          (routingMetrics.atomicPhysicalNetTreeCount || 0) + 1;
        commitPhysicalNetRoutes(atomicRoutes, {
          routedById,
          reservedSegments,
          routingMetrics,
          unroutablePhysicalNets,
          overflowUnroutablePhysicalNets,
          nodeById,
          targetEntryLanes
        });
        continue;
      }
    }
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
    options.onRoutingEdge?.({ phase: "start", edgeIndex, edgeId: edge.id, physicalNetKey });
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
      targetEntryLanes,
      strictRouting: options.strictRouting === true,
      net: edge.net,
      netGroupKey: getNetGroupKey(edge)
    });
    options.onRoutingEdge?.({ phase: "complete", edgeIndex, edgeId: edge.id, physicalNetKey });
    const positionedEdge = createPositionedEdge(
      edge,
      source,
      target,
      sourcePoint,
      targetPoint,
      routed,
      edgePlan
    );
    routedById.set(edge.id, positionedEdge);
    routingMetrics.routeKinds[routed.kind] =
      (routingMetrics.routeKinds[routed.kind] || 0) + 1;
    if (positionedEdge.routeStatus === "unroutable") {
      const physicalNetKey = getNetGroupKey(edge);
      unroutablePhysicalNets.add(physicalNetKey);
      if (positionedEdge.capacityOverflow) overflowUnroutablePhysicalNets.add(physicalNetKey);
    }
    routingMetrics.unroutablePhysicalNetCount = unroutablePhysicalNets.size;
    routingMetrics.overflowUnroutablePhysicalNetCount = overflowUnroutablePhysicalNets.size;
    reservedSegments.pushUnique(...getOwnedRouteSegments(positionedEdge.points, edge));
    registerTargetEntryLanes(
      positionedEdge,
      source,
      target,
      targetPoint,
      targetEntryLanes
    );
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

  repairUnroutablePhysicalNetsWithCarriers({
    carrierRoutesByPhysicalNet: options.carrierRoutesByPhysicalNet,
    edgesByPhysicalNet,
    routedById,
    reservedSegments,
    routingMetrics,
    unroutablePhysicalNets,
    overflowUnroutablePhysicalNets,
    nodes,
    nodeIndex,
    nodeById,
    targetEntryLanes
  });

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

function groupEdgesByPhysicalNet(edges) {
  const groups = new Map();
  for (const edge of edges) {
    const key = getNetGroupKey(edge);
    const entries = groups.get(key) || [];
    entries.push(edge);
    groups.set(key, entries);
  }
  return groups;
}

function tryCarrierPhysicalNetGroup(edges, carrierRouteCandidates, context) {
  if (!Array.isArray(carrierRouteCandidates)) return null;
  for (const carrierRoutes of carrierRouteCandidates) {
    const usable = validateCarrierPhysicalNetCandidate(edges, carrierRoutes, context);
    if (usable) return usable;
  }
  return null;
}

function validateCarrierPhysicalNetCandidate(edges, carrierRoutes, context) {
  if (!Array.isArray(carrierRoutes) || carrierRoutes.length !== edges.length) return null;
  const expectedIds = edges.map((edge) => String(edge.id)).toSorted();
  const actualIds = carrierRoutes.map((edge) => String(edge.id)).toSorted();
  if (expectedIds.some((edgeId, index) => edgeId !== actualIds[index])) return null;
  if (carrierRoutes.some((edge) => routeOverlapsReserved(
    edge.points,
    edge.net,
    context.reservedSegments,
    getNetGroupKey(edge)
  ))) return null;
  const commit = validatePhysicalNetCommit(carrierRoutes, context.nodes, {
    nodeIndex: context.nodeIndex
  });
  return commit.status === "routed" ? carrierRoutes : null;
}

function repairUnroutablePhysicalNetsWithCarriers(context) {
  if (!(context.carrierRoutesByPhysicalNet instanceof Map)) return;
  for (const physicalNetKey of [...context.unroutablePhysicalNets].toSorted()) {
    context.routingMetrics.carrierRepairAttemptCount =
      (context.routingMetrics.carrierRepairAttemptCount || 0) + 1;
    const physicalNetEdges = context.edgesByPhysicalNet.get(physicalNetKey) || [];
    const candidates = context.carrierRoutesByPhysicalNet.get(physicalNetKey);
    if (!candidates) {
      context.routingMetrics.carrierRepairMissingCandidateCount =
        (context.routingMetrics.carrierRepairMissingCandidateCount || 0) + 1;
      continue;
    }
    const carrierRoutes = tryCarrierPhysicalNetGroup(
      physicalNetEdges,
      candidates,
      context
    );
    if (!carrierRoutes) {
      context.routingMetrics.carrierRepairRejectedCandidateCount =
        (context.routingMetrics.carrierRepairRejectedCandidateCount || 0) + 1;
      continue;
    }
    for (const edge of physicalNetEdges) {
      const previous = context.routedById.get(edge.id);
      if (!previous?.routeKind) continue;
      context.routingMetrics.routeKinds[previous.routeKind] = Math.max(
        0,
        (context.routingMetrics.routeKinds[previous.routeKind] || 0) - 1
      );
    }
    context.reservedSegments.removeOwner(physicalNetKey);
    context.unroutablePhysicalNets.delete(physicalNetKey);
    context.overflowUnroutablePhysicalNets.delete(physicalNetKey);
    context.routingMetrics.carrierPhysicalNetTreeCount =
      (context.routingMetrics.carrierPhysicalNetTreeCount || 0) + 1;
    context.routingMetrics.carrierRepairedEdgeCount =
      (context.routingMetrics.carrierRepairedEdgeCount || 0) + carrierRoutes.length;
    commitPhysicalNetRoutes(carrierRoutes, context);
  }
}

/**
 * A placement-capped channel is an explicit resource failure, not a hint to
 * borrow a lane assigned to a different boundary.  Before the fanout-tree
 * shortcut or per-edge router sees a physical net, either commit every branch
 * that can use no channel at all (a hard-validated direct path), or publish a
 * single atomic capacity failure for the complete physical net.
 */
function tryRouteCapacityBlockedPhysicalNetGroup(edges, context) {
  const inspected = edges.map((edge) => {
    const source = context.nodeById.get(edge.source);
    const target = context.nodeById.get(edge.target);
    if (!source || !target) return { edge, source, target, edgePlan: null };
    const sourcePoint = getConnectionPoint(source, edge.sourcePin, "source");
    const targetPoint = getConnectionPoint(target, edge.targetPin, "target");
    const edgePlan = applyCapacityLane(
      context.routePlan?.edges?.get(edge.id),
      context.routingCapacity,
      getNetGroupKey(edge),
      {
        sourceLevel: source.level,
        targetLevel: target.level,
        sourceNodeId: source.id,
        targetNodeId: target.id
      }
    );
    return { edge, source, target, sourcePoint, targetPoint, edgePlan };
  });
  if (inspected.some((item) => !item.source || !item.target)) return null;
  if (!inspected.some((item) => item.edgePlan?.capacityBlocked === true)) return null;

  // Prefer one source-rooted overflow tree for fanout groups.  Routing each
  // branch independently can find locally valid paths but lose the shared
  // trunk (or fail the physical-net connectivity check once reservations are
  // committed).  The tree trial is bounded to the same three trunk columns
  // used by the normal physical-net path and commits only as one group.
  if (inspected.length > 1) {
    const overflowTree = tryRoutePhysicalNetGroup(
      edges,
      { ...context, allowCapacityOverflowTree: true }
    );
    if (overflowTree) {
      return overflowTree.map((positionedEdge) => ({
        ...positionedEdge,
        routeKind: "capacity-overflow-tree",
        routeDiagnostics: [{
          code: "routing-capacity-overflow-tree",
          overflowKind: positionedEdge.capacityOverflowKind,
          channelId: positionedEdge.capacityChannelId,
          boundaryClusterKey: positionedEdge.capacityBoundaryClusterKey
        }]
      }));
    }
  }

  const directRoutes = [];
  for (const item of inspected) {
    const direct = item.source && item.target
      ? findCapacityFreeDirectRoute(item, context)
      : null;
    if (!direct) return inspected.map((failed) => createCapacityBlockedPositionedEdge(failed));
    directRoutes.push(createPositionedEdge(
      item.edge,
      item.source,
      item.target,
      item.sourcePoint,
      item.targetPoint,
      direct,
      item.edgePlan
    ));
  }
  if (directRoutes.some((edge) => routeOverlapsReserved(
    edge.points,
    edge.net,
    context.reservedSegments,
    getNetGroupKey(edge)
  )) || validatePhysicalNetCommit(directRoutes, context.nodes, {
    nodeIndex: context.nodeIndex
  }).status !== "routed") {
    return inspected.map((failed) => createCapacityBlockedPositionedEdge(failed));
  }
  return directRoutes;
}

function findCapacityFreeDirectRoute(item, context) {
  const routeContext = {
    source: item.source,
    target: item.target,
    sourcePoint: item.sourcePoint,
    targetPoint: item.targetPoint,
    edgePlan: item.edgePlan,
    levelBounds: context.levelBounds,
    nodes: context.nodes,
    nodeIndex: context.nodeIndex,
    wireLanePitch: context.wireLanePitch,
    routingGeometry: context.routingGeometry,
    edgeIntent: context.layoutIntent?.getEdge(item.edge),
    reservedSegments: context.reservedSegments,
    targetEntryLanes: context.targetEntryLanes,
    targetEntrySeparation: context.routingGeometry?.minimumTargetEntrySeparation,
    net: item.edge.net,
    netGroupKey: getNetGroupKey(item.edge)
  };
  return findCapacityFreeDirectCandidate(routeContext) ||
    findCapacityOverflowCorridorCandidate(routeContext);
}

function findCapacityFreeDirectCandidate(context) {
  return createBasicSimpleRouteCandidates(context).find((candidate) =>
    candidate.kind === "direct" && isHardRouteCandidate(candidate, context)) || null;
}

function findCapacityOverflowCorridorCandidate(context) {
  const edgePlan = context.edgePlan;
  if (!edgePlan || edgePlan.capacityBlocked !== true) return null;
  const overflowPlan = {
    ...edgePlan,
    preferredLaneY: undefined,
    capacityLaneYs: [],
    capacityCorridor: undefined,
    capacityEscape: undefined,
    capacityBlocked: false
  };
  const overflowContext = {
    ...context,
    edgePlan: overflowPlan
  };
  // Keep this pass bounded and local-first.  A capped channel often blocks
  // only the preferred y lane; reusing an existing nearby dogleg is both
  // cheaper and less likely to create a second outer detour.  Every candidate
  // is still checked against the original context (including reservations),
  // so the overflow plan cannot weaken the hard contract.
  const localCandidates = [
    ...createBasicSimpleRouteCandidates(overflowContext),
    ...createLocalObstacleCandidates(overflowContext),
    ...createLocalObstacleCandidates(overflowContext, { reservedDetours: true })
  ];
  const hardLocal = localCandidates.filter((candidate) =>
    isHardRouteCandidate(candidate, context));
  let candidate = hardLocal.length > 0
    ? chooseBestScoredRoute(scoreCandidates(
      hardLocal,
      context.reservedSegments,
      context.net,
      context.netGroupKey,
      context.edgeIntent
    ))
    : null;
  candidate ||= createGlobalFallback(overflowContext);
  if (!isHardRouteCandidate(candidate, context)) return null;
  return {
    ...candidate,
    kind: "capacity-overflow-corridor",
    diagnostics: [{
      code: "routing-capacity-overflow-corridor",
      overflowKind: edgePlan.capacityOverflowKind,
      channelId: edgePlan.capacityChannelId,
      boundaryClusterKey: edgePlan.capacityBoundaryClusterKey,
      requestedLaneIndex: edgePlan.capacityRequestedLaneIndex,
      placementLaneLimit: edgePlan.capacityPlacementLaneLimit
    }]
  };
}

function createCapacityBlockedPositionedEdge(item) {
  const routeContext = {
    source: item.source,
    target: item.target,
    netGroupKey: getNetGroupKey(item.edge)
  };
  const routed = createUnroutableRoute(routeContext, {
    code: "routing-capacity-limit",
    ...getCapacityBlockedDiagnostics(item.edgePlan)
  });
  return createPositionedEdge(
    item.edge,
    item.source,
    item.target,
    item.sourcePoint,
    item.targetPoint,
    routed,
    item.edgePlan
  );
}

function getCapacityBlockedDiagnostics(edgePlan = {}) {
  return {
    channelId: edgePlan.capacityChannelId,
    boundaryClusterKey: edgePlan.capacityBoundaryClusterKey,
    overflowKind: edgePlan.capacityOverflowKind,
    requestedLaneIndex: edgePlan.capacityRequestedLaneIndex,
    placementLaneLimit: edgePlan.capacityPlacementLaneLimit
  };
}

function createPositionedEdge(edge, source, target, sourcePoint, targetPoint, routed, edgePlan) {
  const label = getLabelPlacement(edge, source, target, sourcePoint, targetPoint);
  const preferSegmentLabel = routed.kind === "direct";
  return {
    ...edge,
    points: routed.points,
    routeKind: routed.kind,
    routeStatus: routed.status || "routed",
    routeDiagnostics: routed.diagnostics,
    capacityChannelId: edgePlan?.capacityChannelId,
    capacityBoundaryClusterKey: edgePlan?.capacityBoundaryClusterKey,
    capacityOverflow: edgePlan?.capacityOverflow === true,
    capacityOverflowKind: edgePlan?.capacityOverflowKind,
    capacityBlocked: edgePlan?.capacityBlocked === true,
    labelPoint: preferSegmentLabel ? undefined : label.point,
    labelAnchor: preferSegmentLabel ? undefined : label.anchor
  };
}

function commitPhysicalNetRoutes(routes, context) {
  for (const positionedEdge of routes) {
    context.routedById.set(positionedEdge.id, positionedEdge);
    context.routingMetrics.routeKinds[positionedEdge.routeKind] =
      (context.routingMetrics.routeKinds[positionedEdge.routeKind] || 0) + 1;
    if (positionedEdge.routeStatus === "unroutable") {
      const physicalNetKey = getNetGroupKey(positionedEdge);
      context.unroutablePhysicalNets.add(physicalNetKey);
      if (positionedEdge.capacityOverflow) {
        context.overflowUnroutablePhysicalNets.add(physicalNetKey);
      }
    }
    context.reservedSegments.pushUnique(...getOwnedRouteSegments(positionedEdge.points, positionedEdge));
    const target = context.nodeById?.get(positionedEdge.target);
    if (target) {
      registerTargetEntryLanes(
        positionedEdge,
        context.nodeById?.get(positionedEdge.source),
        target,
        getConnectionPoint(target, positionedEdge.targetPin, "target"),
        context.targetEntryLanes
      );
    }
  }
  context.routingMetrics.unroutablePhysicalNetCount = context.unroutablePhysicalNets.size;
  context.routingMetrics.overflowUnroutablePhysicalNetCount =
    context.overflowUnroutablePhysicalNets.size;
}

function tryRoutePhysicalNetGroup(edges, context) {
  if (edges.length < 2) return null;
  const sortedEdges = [...edges].sort((left, right) =>
    compareEdgesByLayoutPriority(left, right, context.layoutIntent));
  const sourceIds = new Set(sortedEdges.map((edge) => String(edge.source)));
  const sourcePins = new Set(sortedEdges.map((edge) => String(edge.sourcePin || "")));
  if (sourceIds.size !== 1 || sourcePins.size !== 1) return null;
  const source = context.nodeById.get(sortedEdges[0].source);
  // Collapsed groups are valid physical-net sources as long as all branches
  // share one source pin.  The final tree validator still rejects any trunk
  // that crosses an obstacle or foreign reservation.
  if (!source || source.kind === "hub") return null;
  const sourcePoint = getConnectionPoint(source, sortedEdges[0].sourcePin, "source");
  const targets = sortedEdges.map((edge) => ({
    edge,
    node: context.nodeById.get(edge.target)
  }));
  if (targets.some(({ node }) => !node)) return null;
  const edgePlans = targets.map(({ edge, node }) => applyCapacityLane(
    context.routePlan?.edges?.get(edge.id),
    context.routingCapacity,
    getNetGroupKey(edge),
    {
      sourceLevel: source.level,
      targetLevel: node.level,
      sourceNodeId: source.id,
      targetNodeId: node.id
    }
  ));
  if (!context.allowCapacityOverflowTree &&
    edgePlans.some((edgePlan) => edgePlan?.capacityBlocked === true)) return null;
  const targetPoints = targets.map(({ edge, node }) =>
    getConnectionPoint(node, edge.targetPin, "target"));
  const targetRoutePoints = targets.map(({ node }, index) => {
    const targetPoint = targetPoints[index];
    return isVerticalTargetPin(node, targetPoint)
      ? getTargetApproachPoint(
        node,
        targetPoint,
        context.routingGeometry?.targetApproachClearance
      )
      : targetPoint;
  });
  if (targetPoints.some((point) => Math.abs(point.x - sourcePoint.x) <= 4)) return null;
  if (source.kind !== "focus-input" && targetPoints.some((point) =>
    Math.abs(point.y - sourcePoint.y) <= 4)) return null;
  const minimumTargetX = Math.min(...targetRoutePoints.map((point) => point.x));
  const clearance = Number(context.routingGeometry?.nodeClearance) || 8;
  const sourceEscapeX = getEscapeLaneX(source, sourcePoint, "source", clearance);
  if (!(minimumTargetX > sourcePoint.x + clearance)) return null;
  const maximumTrunkX = minimumTargetX -
    (Number(context.routingGeometry?.targetApproachClearance) || 9);
  const minimumTrunkX = sourceEscapeX;
  let trunkXs = buildBoundedTrunkXs(
    minimumTrunkX,
    maximumTrunkX,
    sourcePoint.x,
    minimumTargetX
  );
  if (context.trunkBias) {
    trunkXs = trunkXs.toSorted((left, right) => context.trunkBias * (right - left));
  }

  for (const trunkX of trunkXs) {
    const positionedEdges = targets.map(({ edge, node }, index) => {
      const targetPoint = targetPoints[index];
      const targetRoutePoint = targetRoutePoints[index];
      const edgePlan = edgePlans[index];
      const label = getLabelPlacement(edge, source, node, sourcePoint, targetPoint);
      const treePoints = isVerticalTargetPin(node, targetPoint)
        ? [
          sourcePoint,
          { x: trunkX, y: sourcePoint.y },
          { x: trunkX, y: targetRoutePoint.y },
          { x: targetRoutePoint.x, y: targetRoutePoint.y },
          targetRoutePoint,
          targetPoint
        ]
        : [
          sourcePoint,
          { x: trunkX, y: sourcePoint.y },
          { x: trunkX, y: targetPoint.y },
          targetPoint
        ];
      return {
        ...edge,
        points: compactOrthogonalPoints(treePoints),
        routeKind: "physical-net-tree",
        routeStatus: "routed",
        capacityChannelId: edgePlan?.capacityChannelId,
        capacityBoundaryClusterKey: edgePlan?.capacityBoundaryClusterKey,
        capacityOverflow: edgePlan?.capacityOverflow === true,
        capacityOverflowKind: edgePlan?.capacityOverflowKind,
        capacityBlocked: edgePlan?.capacityBlocked === true,
        labelPoint: label.point,
        labelAnchor: label.anchor
      };
    });
    if (positionedEdges.some((edge) => !isTargetEntryVisuallyClear(
      edge.points,
      {
        source: context.nodeById.get(edge.source),
        target: context.nodeById.get(edge.target),
        targetPoint: getConnectionPoint(
          context.nodeById.get(edge.target),
          edge.targetPin,
          "target"
        ),
        targetEntryLanes: context.targetEntryLanes,
        targetEntrySeparation: context.routingGeometry?.minimumTargetEntrySeparation,
        netGroupKey: getNetGroupKey(edge)
      }
    ))) {
      recordPhysicalNetTrial(context, sortedEdges, "target-entry");
      continue;
    }
    if (positionedEdges.some((edge) => routeOverlapsReserved(
      edge.points,
      edge.net,
      context.reservedSegments,
      getNetGroupKey(edge)
    ))) {
      recordPhysicalNetTrial(context, sortedEdges, "reserved-overlap");
      continue;
    }
    const commit = validatePhysicalNetCommit(positionedEdges, context.nodes, {
      nodeIndex: context.nodeIndex
    });
    if (commit.status === "routed") return positionedEdges;
    recordPhysicalNetTrial(context, sortedEdges, "hard-validation", commit.diagnostics);
  }
  return null;
}

function recordPhysicalNetTrial(context, edges, reason, diagnostics = []) {
  const metrics = context.routingMetrics;
  if (!metrics) return;
  metrics.physicalNetTrialRejectCounts ||= {};
  metrics.physicalNetTrialRejectCounts[reason] =
    (metrics.physicalNetTrialRejectCounts[reason] || 0) + 1;
  metrics.physicalNetTrialRejectSamples ||= [];
  if (metrics.physicalNetTrialRejectSamples.length >= 8) return;
  metrics.physicalNetTrialRejectSamples.push({
    physicalNetKey: getNetGroupKey(edges[0]),
    reason,
    violations: [...new Set((diagnostics || []).map((item) => item.code))]
  });
}

function compareFocusedPhysicalNetDifficulty(leftEntry, rightEntry, nodeById) {
  const left = measureFocusedPhysicalNetDifficulty(leftEntry[1], nodeById);
  const right = measureFocusedPhysicalNetDifficulty(rightEntry[1], nodeById);
  return left.horizontalGap - right.horizontalGap ||
    right.verticalSpan - left.verticalSpan ||
    String(leftEntry[0]).localeCompare(String(rightEntry[0]));
}

function measureFocusedPhysicalNetDifficulty(edges, nodeById) {
  const source = nodeById.get(edges[0]?.source);
  const targets = edges.map((edge) => nodeById.get(edge.target)).filter(Boolean);
  if (source?.kind !== "focus-input" || targets.length === 0) {
    return { horizontalGap: Infinity, verticalSpan: 0 };
  }
  const sourceRight = Number(source.x) + Number(source.width);
  const horizontalGap = Math.min(...targets.map((target) => Number(target.x))) - sourceRight;
  const sourceCenter = Number(source.y) + Number(source.height) / 2;
  const targetCenters = targets.map((target) => Number(target.y) + Number(target.height) / 2);
  return {
    horizontalGap,
    verticalSpan: Math.max(...targetCenters.map((center) => Math.abs(center - sourceCenter)))
  };
}

function tryRoutePhysicalNetGroupWithCandidates(edges, context) {
  const positionedEdges = [];
  for (const edge of [...edges].sort((left, right) =>
    compareEdgesByLayoutPriority(left, right, context.layoutIntent))) {
    const source = context.nodeById.get(edge.source);
    const target = context.nodeById.get(edge.target);
    if (!source || !target) return null;
    const sourcePoint = getConnectionPoint(source, edge.sourcePin, "source");
    const targetPoint = getConnectionPoint(target, edge.targetPin, "target");
    const edgePlan = applyCapacityLane(
      context.routePlan?.edges?.get(edge.id),
      context.routingCapacity,
      getNetGroupKey(edge),
      {
        sourceLevel: source.level,
        targetLevel: target.level,
        sourceNodeId: source.id,
        targetNodeId: target.id
      }
    );
    const routed = routeEdge({
      ...context,
      source,
      target,
      sourcePoint,
      targetPoint,
      edgePlan,
      edgeIntent: context.layoutIntent.getEdge(edge),
      net: edge.net,
      netGroupKey: getNetGroupKey(edge)
    });
    if (routed.status === "unroutable" || routed.kind === "unroutable") return null;
    positionedEdges.push(createPositionedEdge(
      edge,
      source,
      target,
      sourcePoint,
      targetPoint,
      routed,
      edgePlan
    ));
  }
  const commit = validatePhysicalNetCommit(positionedEdges, context.nodes, {
    nodeIndex: context.nodeIndex
  });
  return commit.status === "routed" ? positionedEdges : null;
}

function buildBoundedTrunkXs(minimum, maximum, sourceX, targetX) {
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum < minimum) return [];
  const midpoint = (minimum + maximum) / 2;
  const candidates = [minimum, midpoint, maximum];
  for (let step = 1; step <= 8; step += 1) {
    candidates.push(midpoint - step * 8, midpoint + step * 8);
  }
  return [...new Set(candidates
    .filter((value) => value > sourceX && value < targetX &&
      value >= minimum && value <= maximum)
    .map((value) => Math.round(value * 1000) / 1000))]
    .toSorted((left, right) => Math.abs(left - midpoint) - Math.abs(right - midpoint) || left - right)
    .slice(0, 17);
}

function applyCapacityLane(edgePlan, routingCapacity, netGroupKey, edgeContext = {}) {
  if (!routingCapacity?.allocationByNet) return edgePlan;
  const assignments = routingCapacity.allocationByNet.get(netGroupKey) || [];
  const sourceBoundaryId = getSourceBoundaryChannelId(
    edgeContext.sourceLevel,
    edgeContext.targetLevel
  );
  const interLayerAssignments = assignments.filter((assignment) =>
    String(assignment.channelId).startsWith("inter-layer:"));
  const sourceAssignment = sourceBoundaryId
    ? interLayerAssignments.find((assignment) => assignment.channelId === sourceBoundaryId)
    : null;
  const blockedInterLayerAssignments = interLayerAssignments.filter((assignment) =>
    !hasFiniteCoordinate(assignment) && assignment.capacityOverflow === true);
  // A route crossing several levels must not use a valid first channel as an
  // excuse to silently cross a capped later channel.  Prefer the source
  // boundary in diagnostics, then use allocation order (which is topology
  // stable) for the remaining required boundary.
  const blockedAssignment = sourceAssignment && !hasFiniteCoordinate(sourceAssignment)
    ? sourceAssignment
    : blockedInterLayerAssignments[0];
  const physicalNetCapacityOverflow = assignments.some((assignment) =>
    assignment.capacityOverflow === true);
  if (blockedAssignment) {
    return {
      ...(edgePlan || {}),
      preferredLaneY: undefined,
      capacityLaneYs: [],
      capacityOverflow: true,
      physicalNetCapacityOverflow,
      capacityOverflowKind: getCapacityOverflowKind(blockedAssignment),
      capacityBlocked: true,
      capacityChannelId: blockedAssignment.channelId,
      capacityBoundaryClusterKey: blockedAssignment.boundaryClusterKey,
      capacityRequestedLaneIndex: blockedAssignment.requestedLaneIndex,
      capacityPlacementLaneLimit: blockedAssignment.placementLaneLimit,
      capacityCorridor: undefined,
      capacityEscape: undefined,
      rowGapLanes: []
    };
  }
  const topAssignment = assignments.find((assignment) =>
    assignment.channelId === "outer-top" && hasFiniteCoordinate(assignment));
  const localAssignments = interLayerAssignments.filter(hasFiniteCoordinate);
  // When a source boundary was modeled, only that exact assignment can set
  // the source escape.  Falling back to a later boundary revives an invalid
  // lane after a placement cap and makes the result parser/order dependent.
  const localAssignment = sourceAssignment && hasFiniteCoordinate(sourceAssignment)
    ? sourceAssignment
    : sourceBoundaryId
      ? null
      : localAssignments[0];
  const rowGapAssignments = assignments
    .filter((assignment) => String(assignment.channelId).startsWith("row-gap:") &&
      hasFiniteCoordinate(assignment))
    .toSorted((left, right) => String(left.channelId).localeCompare(String(right.channelId)));
  if (!topAssignment && !localAssignment && rowGapAssignments.length === 0) {
    return {
      ...(edgePlan || {}),
      physicalNetCapacityOverflow,
      capacityBlocked: false
    };
  }
  const selectedAssignment = localAssignment || topAssignment || rowGapAssignments[0];
  const capacityLaneYs = collectCapacityLaneYHints(assignments);
  return {
    ...(edgePlan || {}),
    ...(topAssignment ? { topLane: topAssignment.laneIndex } : {}),
    // Row-gap lanes are recorded for diagnostics and future edge-specific
    // corridor selection.  A single edge may cross several row gaps, so
    // blindly choosing the lexically first row coordinate would change route
    // shape for unrelated focused branches.  Inter-layer/outer assignments
    // remain the only global preference until a route has a matching level.
    preferredLaneY: localAssignment?.coordinate ?? topAssignment?.coordinate,
    capacityLaneYs,
    capacityOverflow: selectedAssignment?.capacityOverflow === true,
    physicalNetCapacityOverflow,
    capacityOverflowKind: getCapacityOverflowKind(selectedAssignment),
    capacityBlocked: false,
    capacityChannelId: selectedAssignment?.channelId,
    capacityBoundaryClusterKey: selectedAssignment?.boundaryClusterKey,
    capacityRequestedLaneIndex: selectedAssignment?.requestedLaneIndex,
    capacityPlacementLaneLimit: selectedAssignment?.placementLaneLimit,
    capacityCorridor: selectedAssignment ? {
      channelId: selectedAssignment.channelId,
      boundaryClusterKey: selectedAssignment.boundaryClusterKey,
      laneIndex: selectedAssignment.laneIndex,
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

function getCapacityOverflowKind(assignment) {
  if (!assignment?.capacityOverflow) return null;
  return assignment.overflowKind ||
    (assignment.placementOverflow === true ? "placement" : "allocator");
}

/**
 * Preserve a small, deterministic set of allocated horizontal corridors for
 * the global candidate search.  Assignments can contain one entry per
 * traversed boundary (and two outer bands), so never copy the full list into
 * every edge plan; the fixed cap is part of the routing complexity contract.
 */
function collectCapacityLaneYHints(assignments = []) {
  const values = [];
  const append = (assignment) => {
    if (!hasFiniteCoordinate(assignment)) return;
    const coordinate = Number(assignment.coordinate);
    if (values.some((value) => Math.abs(value - coordinate) < 0.01)) return;
    values.push(coordinate);
  };
  // Keep source-adjacent/inter-layer lanes first, then make sure both outer
  // bands remain represented even when a long edge crosses many boundaries.
  for (const assignment of assignments) {
    if (!String(assignment?.channelId || "").startsWith("outer-")) append(assignment);
    if (values.length >= MAX_CAPACITY_LANE_Y_HINTS - 2) break;
  }
  for (const kind of ["outer-top", "outer-bottom"]) {
    append(assignments.find((assignment) => assignment?.channelId === kind));
  }
  return values.slice(0, MAX_CAPACITY_LANE_Y_HINTS);
}

function hasFiniteCoordinate(assignment) {
  return assignment?.coordinate !== null &&
    assignment?.coordinate !== undefined &&
    Number.isFinite(Number(assignment.coordinate));
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
    netGroupKey = undefined,
    targetEntryLanes
  } = context;
  if (edgePlan?.capacityBlocked === true) {
    const capacityFree = findCapacityFreeDirectCandidate(context) ||
      findCapacityOverflowCorridorCandidate(context);
    return capacityFree || createUnroutableRoute(context, {
      code: "routing-capacity-limit",
      ...getCapacityBlockedDiagnostics(edgePlan)
    });
  }
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
    if (!localHasOverlap) {
      return bestLocal;
    }
    // Outer lanes are a reachability fallback, not a peer in weighted route
    // selection. A hard-valid local route always wins even if it crosses
    // perpendicular wires, because bridges make those crossings representable.
    routingMetrics.globalFallbacks += 1;
    const globalCandidate = createGlobalFallback(context);
    if (isHardRouteCandidate(globalCandidate, context)) {
      return globalCandidate;
    }
    if (localHasOverlap) {
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
  if (!isHardRouteCandidate(globalFallback, context)) {
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
  const pitch = Math.max(4, Number(context.wireLanePitch) || 24);
  const laneX = findInteriorVerticalLaneX(points);
  if (Number.isFinite(laneX)) {
    const verticalLaneStep = Math.max(4, Math.min(8, pitch));
    const offsets = [...new Set([
      ...Array.from({ length: 12 }, (_, index) => (index + 1) * verticalLaneStep),
      ...Array.from({ length: 12 }, (_, index) => (index + 1) * pitch)
    ].flatMap((offset) => [offset, -offset]))];
    for (const offset of offsets) {
      const shiftedPoints = points.map((point, index) =>
        index > 0 && index < points.length - 1 && Math.abs(point.x - laneX) < 0.5
          ? { ...point, x: point.x + offset }
          : point);
      const shifted = { ...candidate, points: shiftedPoints };
      if (candidateIsUsable(shifted, context) && !routeOverlapsReserved(
        shifted.points,
        context.net,
        context.reservedSegments,
        context.netGroupKey
      )) return shifted;
    }
  }
  const laneY = findInteriorHorizontalLaneY(points);
  if (!Number.isFinite(laneY)) return null;
  const horizontalOffsets = [pitch, -pitch, pitch * 2, -pitch * 2, pitch * 3, -pitch * 3];
  const verticalOffsets = [
    0,
    pitch, -pitch,
    pitch * 2, -pitch * 2,
    pitch * 3, -pitch * 3,
    pitch * 4, -pitch * 4,
    pitch * 5, -pitch * 5,
    pitch * 6, -pitch * 6,
    pitch * 7, -pitch * 7,
    pitch * 8, -pitch * 8
  ];
  const sourceLaneX = points.length > 2 ? points[1].x : null;
  const targetLaneX = points.length > 3 ? points.at(-2).x : null;
  const shiftPlans = [
    ...verticalOffsets.flatMap((sourceOffset) => [
      { source: sourceOffset, target: 0 },
      { source: 0, target: sourceOffset }
    ]),
    ...verticalOffsets
      .filter((offset) => offset !== 0)
      .map((offset) => ({ source: offset, target: offset }))
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

function findInteriorVerticalLaneX(points) {
  let laneX = null;
  let longest = 0;
  for (let index = 1; index < points.length - 2; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (Math.abs(start.x - end.x) >= 0.5) continue;
    const length = Math.abs(start.y - end.y);
    if (length > longest) {
      longest = length;
      laneX = start.x;
    }
  }
  return laneX;
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
    capacityLaneYs: context.edgePlan?.capacityLaneYs,
    margin: context.margin,
    lanePitch: context.topWireLanePitch,
    nodeIndex: context.nodeIndex,
    globalLaneGeometry: context.globalLaneGeometry,
    reservedSegments: context.reservedSegments,
    net: context.net,
    netGroupKey: context.netGroupKey,
    targetEntryLanes: context.targetEntryLanes,
    targetEntrySeparation: context.routingGeometry?.minimumTargetEntrySeparation,
    routingGeometry: context.routingGeometry
  });
}

function candidateIsUsable(candidate, context) {
  const usable = routeCandidateIsUsable(candidate.points, {
    source: context.source,
    target: context.target,
    sourcePoint: context.sourcePoint,
    targetPoint: context.targetPoint,
    nodeIndex: context.nodeIndex,
    net: context.net,
    netGroupKey: context.netGroupKey,
    reservedSegments: context.reservedSegments,
    targetEntryLanes: context.targetEntryLanes,
    targetEntrySeparation: context.routingGeometry?.minimumTargetEntrySeparation,
    routingGeometry: context.routingGeometry
  }, {
    nodePadding: context.source?.kind === "cell" && context.target?.kind === "cell" ? 0 : undefined,
    allowNodePaddingBoundary: true
  });
  if (!usable) return false;
  return !routeTraversesNonEndpointBoundary(candidate.points, context);
}

function routeTraversesNonEndpointBoundary(points, context) {
  if (context.source?.kind !== "cell" || context.target?.kind !== "cell") return false;
  for (let index = 0; index < (points?.length || 0) - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const left = Math.min(start.x, end.x);
    const right = Math.max(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const bottom = Math.max(start.y, end.y);
    for (const node of context.nodeIndex.query({ left, right, top, bottom })) {
      if (node.id === context.source.id || node.id === context.target.id) continue;
      const nodeRight = Number(node.x) + Number(node.width);
      const nodeBottom = Number(node.y) + Number(node.height);
      const horizontalBoundary = Math.abs(start.y - end.y) < 0.5 &&
        (Math.abs(start.y - Number(node.y)) < 0.5 || Math.abs(start.y - nodeBottom) < 0.5) &&
        Math.min(right, nodeRight) - Math.max(left, Number(node.x)) > 0.01;
      const verticalBoundary = Math.abs(start.x - end.x) < 0.5 &&
        (Math.abs(start.x - Number(node.x)) < 0.5 || Math.abs(start.x - nodeRight) < 0.5) &&
        Math.min(bottom, nodeBottom) - Math.max(top, Number(node.y)) > 0.01;
      if (horizontalBoundary || verticalBoundary) return true;
    }
  }
  return false;
}

function registerTargetEntryLanes(edge, source, target, targetPoint, targetEntryLanes) {
  if (!targetEntryLanes || !target?.id || edge?.routeStatus === "unroutable") return;
  const targetY = Number(targetPoint?.y);
  if (!Number.isFinite(targetY)) return;
  const targetId = String(target.id);
  const entries = targetEntryLanes.get(targetId) || [];
  const netGroupKey = getNetGroupKey(edge);
  for (let index = 0; index < (edge.points?.length || 0) - 1; index += 1) {
    const start = edge.points[index];
    const end = edge.points[index + 1];
    if (Math.abs(Number(start?.x) - Number(end?.x)) >= 0.5) continue;
    const minimum = Math.min(Number(start?.y), Number(end?.y));
    const maximum = Math.max(Number(start?.y), Number(end?.y));
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum) ||
      targetY < minimum - 0.5 || targetY > maximum + 0.5) continue;
    if (entries.some((entry) => entry.netGroupKey === netGroupKey &&
      Math.abs(entry.x - Number(start.x)) < 0.01 &&
      Math.abs(entry.minimum - minimum) < 0.01 &&
      Math.abs(entry.maximum - maximum) < 0.01)) continue;
    entries.push({
      x: Number(start.x),
      minimum,
      maximum,
      netGroupKey,
      sourceKind: source?.kind
    });
  }
  if (entries.length > 0) targetEntryLanes.set(targetId, entries);
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
