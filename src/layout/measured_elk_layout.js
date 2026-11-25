import { compactElkPoints, getElkEdgePoints } from "./elk_edge_sections.js";
import {
  computeBoundsWithRoutes,
  computeSafeLayoutExtent,
  getConnectionPoint,
  getPort,
  translateLayoutGeometry
} from "./nodeGeometry.js";
import { materializeMeasuredGraph } from "./measured_geometry.js";
import { MEASURED_GRAPH_CONTRACT } from "../contracts/measured_graph.js";
import { applyPositionedOverrides } from "./positionedRouting.js";
import { ELK_WIRE_LABEL_OFFSET } from "./wireLabelPolicy.js";
import { placeWireLabels } from "./wireLabelPlacement.js";
import { buildWireRoutes } from "./wireRoutes.js";
import { finalizeLayoutGraph } from "./layoutValidator.js";

export const ELK_LAYOUT_PROVIDER_ID = "elk-layered";

export class MeasuredElkLayoutProvider {
  constructor(options = {}) {
    this.id = ELK_LAYOUT_PROVIDER_ID;
    this.label = "ELK Layered (Experimental)";
    this.experimental = true;
    this.executionMode = "async";
    this.measurementContract = MEASURED_GRAPH_CONTRACT;
    this.elkFactory = options.elkFactory || (() => {
      if (typeof globalThis.ELK !== "function") {
        throw new Error("Vendored ELK runtime is not loaded");
      }
      return new globalThis.ELK();
    });
  }

  async layoutMeasured(measuredGraph, options = {}) {
    const graph = materializeMeasuredGraph(measuredGraph);
    const cellSpacing = Number(options.layoutPolicy?.spacing?.cellSpacing) || 8;
    const measuredNodes = graph.nodes;
    const measuredNodeById = new Map(measuredNodes.map((node) => [node.id, node]));
    const portIds = buildElkPortIds(graph);
    const elkGraph = {
      id: "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.spacing.nodeNode": String(40 + cellSpacing),
        "elk.layered.spacing.nodeNodeBetweenLayers": String(72 + cellSpacing),
        "elk.edgeRouting": "ORTHOGONAL"
      },
      children: measuredNodes.map((node) => toElkNode(node, portIds)),
      edges: graph.edges.map((edge) => toElkEdge(edge, measuredNodeById, portIds))
    };
    const result = await this.elkFactory().layout(elkGraph);
    const childById = new Map((result.children || []).map((child) => [child.id, child]));
    const positionedNodes = measuredNodes.map((node) => {
      const child = childById.get(node.id) || {};
      const positioned = { ...node, x: child.x || 0, y: child.y || 0 };
      return positioned;
    });
    const elkEdgeById = new Map((result.edges || []).map((edge) => [edge.id, edge]));
    const positionedNodeById = new Map(positionedNodes.map((node) => [node.id, node]));
    const routedEdges = graph.edges.map((edge) => {
      const source = positionedNodeById.get(edge.source);
      const target = positionedNodeById.get(edge.target);
      const rawRoute = getElkEdgePoints(elkEdgeById.get(edge.id),
        source && getConnectionPoint(source, edge.sourcePin, "source"));
      if (rawRoute.status === "unroutable") {
        return {
          ...edge,
          points: [],
          routeKind: "unroutable",
          routeStatus: "unroutable",
          routeDiagnostics: rawRoute.diagnostics
        };
      }
      const rawPoints = rawRoute.points;
      const sourcePort = source && getPort(source, edge.sourcePin, "source");
      const targetPort = target && getPort(target, edge.targetPin, "target");
      const points = source && target
        ? attachToExactPorts(
          rawPoints,
          getConnectionPoint(source, edge.sourcePin, "source"),
          getConnectionPoint(target, edge.targetPin, "target"),
          sourcePort?.side,
          targetPort?.side
        )
        : rawPoints;
      return {
        ...edge,
        points,
        routeKind: "elk-orthogonal",
        routeStatus: "routed"
      };
    });
    const positionedEdges = placeWireLabels(routedEdges, positionedNodes, {
      order: "longest",
      minimumPadding: 32,
      baselineOffsets: [ELK_WIRE_LABEL_OFFSET],
      checkCollisions: false,
      includeEmpty: true
    });
    const wireRoutes = buildWireRoutes(positionedEdges, { measuredRoutes: true });
    const bounds = computeBoundsWithRoutes(positionedNodes, positionedEdges, wireRoutes);
    translateLayoutGeometry(positionedNodes, positionedEdges, wireRoutes, {
      x: Math.max(0, -bounds.left),
      y: Math.max(0, -bounds.top)
    });
    const normalizedBounds = computeBoundsWithRoutes(positionedNodes, positionedEdges, wireRoutes);
    const safeExtent = computeSafeLayoutExtent(normalizedBounds, 0, {
      width: result.width || 0,
      height: result.height || 0
    });
    const positionedGraph = {
      ...graph,
      nodes: positionedNodes,
      edges: positionedEdges,
      wireRoutes,
      width: safeExtent.width,
      height: safeExtent.height,
      layoutProvider: this.id
    };
    return finalizeLayoutGraph(applyPositionedOverrides(positionedGraph, {
      ...options,
      validate: false
    }));
  }
}

function toElkNode(node, portIds) {
  const ports = node.ports.length ? node.ports
    : [implicitPort(node, "source"), implicitPort(node, "target")];
  return {
    id: node.id,
    width: node.width,
    height: node.height,
    layoutOptions: { "elk.portConstraints": "FIXED_POS" },
    ports: ports.flatMap((port) => {
      // Inout terminals may have different measured source/target offsets.
      return elkPortRoles(port).map((role) => {
        const x = port.x + node.connectionOffsets[role].x;
        const y = port.y + node.connectionOffsets[role].y;
        return {
          id: portIds.get(node.id).get(port.id)[role],
          // Supply the exact connection point before routing. Port boxes shift
          // ELK endpoints; applying offsets afterwards can consume a short lead.
          width: 0,
          height: 0,
          x,
          y,
          layoutOptions: {
            "elk.port.side": sideToElk(port.side),
            // FIXED_POS fixes the coordinate along the side; ELK needs an
            // explicit border offset to retain a terminal outside that side.
            "elk.port.borderOffset": String(port.side === "left" ? -x
              : port.side === "right" ? x - node.width
                : port.side === "top" ? -y : y - node.height)
          }
        };
      });
    })
  };
}

function toElkEdge(edge, nodeById, portIds) {
  const source = nodeById.get(edge.source);
  const target = nodeById.get(edge.target);
  const sourcePort = getPort(source, edge.sourcePin, "source") || implicitPort(source, "source");
  const targetPort = getPort(target, edge.targetPin, "target") || implicitPort(target, "target");
  return {
    id: edge.id,
    sources: [portIds.get(source.id).get(sourcePort.id).source],
    targets: [portIds.get(target.id).get(targetPort.id).target]
  };
}

function buildElkPortIds(graph) {
  const occupied = new Set(["root", ...graph.nodes.map((node) => node.id), ...graph.edges.map((edge) => edge.id)]);
  const portIds = new Map();
  const candidates = [];
  const counts = new Map();
  for (const node of graph.nodes) {
    const ports = node.ports.length ? node.ports
      : [implicitPort(node, "source"), implicitPort(node, "target")];
    const nodePortIds = new Map();
    portIds.set(node.id, nodePortIds);
    for (const port of ports) {
      nodePortIds.set(port.id, {});
      for (const role of elkPortRoles(port)) {
        const id = elkPortId(node.id, port, role);
        candidates.push({ nodeId: node.id, port, role, id });
        counts.set(id, (counts.get(id) || 0) + 1);
      }
    }
  }
  // Extending the greatest existing ID puts the fallback namespace beyond all
  // node, edge and port IDs, without a graph-sized retry loop or order dependence.
  let greatestId = "root";
  for (const id of occupied) if (id > greatestId) greatestId = id;
  for (const { id } of candidates) if (id > greatestId) greatestId = id;
  for (const { nodeId, port, role, id } of candidates) {
    const resolvedId = occupied.has(id) || counts.get(id) > 1
      ? `${greatestId}::port:${JSON.stringify([nodeId, port.id, role])}` : id;
    const ids = portIds.get(nodeId).get(port.id);
    if (port.direction === "inout") ids[role] = resolvedId;
    else ids.source = ids.target = resolvedId;
  }
  return portIds;
}

function elkPortRoles(port) {
  return port.direction === "inout" ? ["source", "target"]
    : [port.direction === "output" ? "source" : "target"];
}

function implicitPort(node, role) {
  // Match getConnectionPoint's portless-node boundary without adding public
  // ports or letting ELK choose unrelated connection points on the node body.
  return { id: role, direction: role === "source" ? "output" : "input",
    side: role === "source" ? "right" : "left",
    x: role === "source" ? node.width : 0, y: node.height / 2 };
}

function elkPortId(nodeId, port, role) {
  const id = `${nodeId}::${port.direction}:${encodeURIComponent(port.rawPin || port.pin || port.id)}`;
  return port.direction === "inout" ? `${id}::${role}` : id;
}

function attachToExactPorts(points, start, end, sourceSide = "right", targetSide = "left") {
  const rawStart = points[0] || start;
  const rawEnd = points.at(-1) || end;
  const sourceEscape = offsetFromPort(start, sourceSide, 24);
  const targetEscape = offsetFromPort(end, targetSide, 24);
  // Only attach an endpoint if the returned section actually missed its pin.
  const sourceMatches = samePoint(start, rawStart);
  const targetMatches = samePoint(end, rawEnd);
  const sourceBridge = sourceMatches
    ? []
    : [sourceEscape, ...alignEscapeToPoint(sourceEscape, rawStart, sourceSide), rawStart];
  const targetBridge = targetMatches
    ? []
    : [rawEnd, ...alignEscapeToPoint(rawEnd, targetEscape, targetSide), targetEscape];
  return compactElkPoints([
    sourceMatches ? rawStart : start,
    ...sourceBridge,
    ...points.slice(1, -1),
    ...targetBridge,
    targetMatches ? rawEnd : end
  ]);
}

function samePoint(left, right) {
  // ELK and getConnectionPoint add local coordinates/offsets in different
  // orders. Preserve the orthogonal section for machine-roundoff differences;
  // this is not the geometric tolerance used by the shared routing validator.
  const sameCoordinate = (a, b) => Math.abs(a - b) <=
    4 * Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
  return sameCoordinate(left.x, right.x) && sameCoordinate(left.y, right.y);
}

function sideToElk(side) {
  return {
    left: "WEST",
    right: "EAST",
    top: "NORTH",
    bottom: "SOUTH"
  }[side] || "WEST";
}

function offsetFromPort(point, side, distance) {
  const amount = Number(distance) || 24;
  if (side === "left") return { x: point.x - amount, y: point.y };
  if (side === "top") return { x: point.x, y: point.y - amount };
  if (side === "bottom") return { x: point.x, y: point.y + amount };
  return { x: point.x + amount, y: point.y };
}

function alignEscapeToPoint(from, to, side) {
  if (side === "top" || side === "bottom") {
    return [{ x: from.x, y: from.y }, { x: to.x, y: from.y }];
  }
  return [{ x: from.x, y: from.y }, { x: from.x, y: to.y }];
}
