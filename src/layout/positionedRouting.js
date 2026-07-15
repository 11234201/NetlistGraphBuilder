import { routeLocalOrthogonalEdge } from "./localOrthogonalRouter.js";
import { buildNodePorts, computeBounds, getConnectionPoint } from "./nodeGeometry.js";
import { normalizeNodeOverrides } from "./nodeOverrides.js";
import {
  getRouteSegments,
  nodeBox,
  segmentIntersectsBox
} from "./orthogonalRouting.js";
import { createNodeSpatialIndex, RouteSegmentIndex } from "./spatialIndex.js";
import { placeWireLabels } from "./wireLabelPlacement.js";
import { createFanoutPriorityComparator } from "./layoutTopology.js";

export function applyPositionedOverrides(positionedGraph, options = {}) {
  const nodePositions = normalizeNodeOverrides(options.nodePositions);
  const nodeSizes = normalizeNodeOverrides(options.nodeSizes);
  if (nodePositions.size === 0 && nodeSizes.size === 0) return positionedGraph;

  const cellPinPitch = options.layoutPolicy?.spacing?.cellPinPitch;
  const margin = options.layoutPolicy?.spacing?.margin || 48;
  const nodes = applyNodeOverrides(positionedGraph.nodes, nodePositions, nodeSizes, cellPinPitch);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const nodeIndex = createNodeSpatialIndex(nodes);
  const changedNodeIds = new Set([...nodePositions.keys(), ...nodeSizes.keys()]);
  const changedNodes = nodes.filter((node) => changedNodeIds.has(node.id));
  const rerouteEdgeIds = new Set(positionedGraph.edges
    .filter((edge) => edgeNeedsReroute(edge, changedNodeIds, changedNodes))
    .map((edge) => edge.id));
  const reservedSegments = new RouteSegmentIndex(positionedGraph.edges
    .filter((edge) => !rerouteEdgeIds.has(edge.id))
    .flatMap((edge) => getRouteSegments(edge.points || [], edge.net)));

  const compareEdges = createFanoutPriorityComparator(positionedGraph.edges);
  const routedById = new Map();
  for (const edge of positionedGraph.edges.toSorted(compareEdges)) {
    if (!rerouteEdgeIds.has(edge.id)) {
      routedById.set(edge.id, edge);
      continue;
    }
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) {
      routedById.set(edge.id, edge);
      continue;
    }
    const start = getConnectionPoint(source, edge.sourcePin, "source");
    const end = getConnectionPoint(target, edge.targetPin, "target");
    const points = routeLocalOrthogonalEdge({
      source,
      target,
      start,
      end,
      nodes,
      nodeIndex,
      margin,
      net: edge.net,
      reservedSegments
    });
    const routedEdge = {
      ...edge,
      points,
      routeKind: "positioned-override",
      labelPoint: points[Math.max(1, points.length - 2)] || end,
      labelAnchor: "end"
    };
    reservedSegments.push(...getRouteSegments(points, edge.net));
    routedById.set(edge.id, routedEdge);
  }
  const routedEdges = positionedGraph.edges.map((edge) => routedById.get(edge.id) || edge);
  const edges = placeWireLabels(routedEdges, nodes, { compareEdges });
  const bounds = computeBounds(nodes);
  return {
    ...positionedGraph,
    nodes,
    edges,
    width: bounds.width + margin,
    height: bounds.height + margin,
    hasPositionOverrides: true
  };
}

function applyNodeOverrides(nodes, nodePositions, nodeSizes, cellPinPitch) {
  return nodes.map((node) => {
    const position = nodePositions.get(node.id);
    const size = nodeSizes.get(node.id);
    const next = {
      ...node,
      x: position?.x ?? node.x,
      y: position?.y ?? node.y,
      width: size?.width ?? node.width,
      height: size?.height ?? node.height
    };
    next.ports = buildNodePorts(next, next, cellPinPitch);
    return next;
  });
}

function edgeNeedsReroute(edge, changedNodeIds, changedNodes) {
  if (changedNodeIds.has(edge.source) || changedNodeIds.has(edge.target)) return true;
  return changedNodes.some((node) =>
    node.id !== edge.source &&
    node.id !== edge.target &&
    polylineIntersectsNode(edge.points, node));
}

function polylineIntersectsNode(points, node) {
  if (!Array.isArray(points)) return false;
  const box = nodeBox(node, 8);
  return points.some((point, index) => index < points.length - 1 &&
    segmentIntersectsBox(point, points[index + 1], box));
}
