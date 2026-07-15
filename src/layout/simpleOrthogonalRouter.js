import { compareEdgesByLayoutPriority } from "./layoutIntent.js";
import { getConnectionPoint } from "./nodeGeometry.js";
import { getRouteSegments } from "./orthogonalRouting.js";
import { routeCandidateIsUsable } from "./routeCandidateValidation.js";
import { compareRouteCandidates, scoreRouteCandidate } from "./routeScoring.js";
import {
  computeLevelBounds,
  createBasicSimpleRouteCandidates,
  createLocalObstacleCandidates,
  findObstacleAvoidingRoute
} from "./simpleRouteCandidates.js";
import { createNodeSpatialIndex, RouteSegmentIndex } from "./spatialIndex.js";
import { placeWireLabels } from "./wireLabelPlacement.js";

export function routeSimpleEdges(graph, nodes, options) {
  const { layoutIntent, routePlan, wireLanePitch, topWireLanePitch, margin } = options;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const nodeIndex = createNodeSpatialIndex(nodes);
  const levelBounds = computeLevelBounds(nodes);
  const routedById = new Map();
  const reservedSegments = new RouteSegmentIndex();

  for (const edge of graph.edges.toSorted((left, right) =>
    compareEdgesByLayoutPriority(left, right, layoutIntent))) {
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
      wireLanePitch,
      topWireLanePitch,
      margin,
      edgeIntent: layoutIntent.getEdge(edge),
      reservedSegments,
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
    reservedSegments.push(...getRouteSegments(positionedEdge.points, edge.net));
  }

  const routedEdges = graph.edges.map((edge) => routedById.get(edge.id) || edge);
  return placeWireLabels(routedEdges, nodes, { preferExisting: true });
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
    net
  } = context;
  const candidates = createBasicSimpleRouteCandidates(context);
  const basicCandidates = candidates.filter((candidate) =>
    candidateIsUsable(candidate, context));
  const conflictFreeBasic = basicCandidates.filter((candidate) =>
    scoreRouteCandidate(candidate, { reservedSegments, net, edgeIntent }).crossings === 0);
  if (conflictFreeBasic.length > 0) {
    return chooseBestRoute(conflictFreeBasic, reservedSegments, net, edgeIntent);
  }

  candidates.push(...createLocalObstacleCandidates(context));
  const usableCandidates = candidates.filter((candidate) => candidateIsUsable(candidate, context));
  if (usableCandidates.length > 0) {
    return chooseBestRoute(usableCandidates, reservedSegments, net, edgeIntent);
  }

  return findObstacleAvoidingRoute({
    source,
    target,
    sourcePoint,
    targetPoint,
    nodes,
    preferredLaneY: margin / 2 + (edgePlan?.topLane || 0) * topWireLanePitch,
    margin,
    lanePitch: topWireLanePitch,
    nodeIndex
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

function chooseBestRoute(candidates, reservedSegments, net, edgeIntent) {
  return candidates.toSorted((left, right) =>
    compareRouteCandidates(left, right, { reservedSegments, net, edgeIntent }))[0];
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
