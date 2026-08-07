import { compareEdgesByLayoutPriority } from "./layoutIntent.js";
import { getConnectionPoint } from "./nodeGeometry.js";
import { countRouteConflicts, getRouteSegments } from "./orthogonalRouting.js";
import { routeCandidateIsUsable } from "./routeCandidateValidation.js";
import { scoreRouteCandidate } from "./routeScoring.js";
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
  const { layoutIntent, routePlan, wireLanePitch, topWireLanePitch, margin } = options;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const nodeIndex = createNodeSpatialIndex(nodes);
  const nodeBounds = computeNodeCollectionBox(nodes);
  const levelBounds = computeLevelBounds(nodes);
  const globalLaneGeometry = prepareGlobalLaneGeometry(nodes, 24);
  const routedById = new Map();
  const reservedSegments = new RouteSegmentIndex();
  const orderedEdges = graph.edges.toSorted((left, right) =>
    compareEdgesByLayoutPriority(left, right, layoutIntent));
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
    const routed = routeEdge({
      source,
      target,
      sourcePoint,
      targetPoint,
      edgePlan: routePlan.edges.get(edge.id),
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
      net: edge.net
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
    reservedSegments.push(...getRouteSegments(positionedEdge.points, edge.net));
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
  return labeledEdges;
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
    net
  } = context;
  const candidates = createBasicSimpleRouteCandidates(context);
  const basicCandidates = candidates.filter((candidate) =>
    candidateIsUsable(candidate, context));
  routingMetrics.basicCandidates += basicCandidates.length;
  const scoredBasic = scoreCandidates(basicCandidates, reservedSegments, net, edgeIntent);
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
    if (countRouteConflicts(candidate.points, reservedSegments, net, 1) === 0) {
      return candidate;
    }
  }
  const scoredCandidates = [
    ...scoredBasic,
    ...scoreCandidates(usableLocalCandidates, reservedSegments, net, edgeIntent)
  ];
  if (scoredCandidates.length > 0) {
    return chooseBestScoredRoute(scoredCandidates);
  }

  routingMetrics.globalFallbacks += 1;
  return createGlobalFallback(context);
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
    globalLaneGeometry: context.globalLaneGeometry
  });
}

function candidateIsUsable(candidate, context) {
  return routeCandidateIsUsable(candidate.points, {
    source: context.source,
    target: context.target,
    sourcePoint: context.sourcePoint,
    targetPoint: context.targetPoint,
    nodeIndex: context.nodeIndex
  });
}

function scoreCandidates(candidates, reservedSegments, net, edgeIntent) {
  const context = {
    reservedSegments,
    net,
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
  if (target.kind === "cell" || target.kind === "assign" || target.kind === "output") {
    return {
      point: { x: targetPoint.x - labelWidth - 8, y: targetPoint.y - 6 },
      anchor: "start"
    };
  }
  return { point: { x: sourcePoint.x + 8, y: sourcePoint.y - 6 }, anchor: "start" };
}
