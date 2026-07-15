import { buildNodePorts, computeBounds, getConnectionPoint, getPort, measureNode } from "./nodeGeometry.js";
import { compactOrthogonalPoints } from "./orthogonalRouting.js";
import { applyPositionedOverrides } from "./positionedRouting.js";
import { placeWireLabels } from "./wireLabelPlacement.js";

export const ELK_LAYOUT_PROVIDER_ID = "elk-layered";

export class ElkLayoutProvider {
  constructor(options = {}) {
    this.id = ELK_LAYOUT_PROVIDER_ID;
    this.label = "ELK Layered (Experimental)";
    this.elkFactory = options.elkFactory || (() => {
      if (typeof globalThis.ELK !== "function") {
        throw new Error("Vendored ELK runtime is not loaded");
      }
      return new globalThis.ELK();
    });
  }

  async layout(graph, options = {}) {
    const measuredNodes = graph.nodes.map((node) => {
      const measured = measureNode(node, options.layoutPolicy?.spacing?.cellPinPitch);
      const override = options.nodeSizes?.get(node.id);
      const sized = { ...node, width: override?.width || measured.width, height: override?.height || measured.height };
      sized.ports = buildNodePorts(sized, sized, options.layoutPolicy?.spacing?.cellPinPitch);
      return sized;
    });
    const measuredNodeById = new Map(measuredNodes.map((node) => [node.id, node]));
    const elkGraph = {
      id: "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.spacing.nodeNode": "48",
        "elk.layered.spacing.nodeNodeBetweenLayers": "80",
        "elk.edgeRouting": "ORTHOGONAL"
      },
      children: measuredNodes.map(toElkNode),
      edges: graph.edges.map((edge) => toElkEdge(edge, measuredNodeById))
    };
    const result = await this.elkFactory().layout(elkGraph);
    const childById = new Map((result.children || []).map((child) => [child.id, child]));
    const positionedNodes = measuredNodes.map((node) => {
      const child = childById.get(node.id) || {};
      const positioned = { ...node, x: child.x || 0, y: child.y || 0 };
      positioned.ports = buildNodePorts(positioned, positioned, options.layoutPolicy?.spacing?.cellPinPitch);
      return positioned;
    });
    const elkEdgeById = new Map((result.edges || []).map((edge) => [edge.id, edge]));
    const positionedNodeById = new Map(positionedNodes.map((node) => [node.id, node]));
    const routedEdges = graph.edges.map((edge) => {
      const rawPoints = getEdgePoints(elkEdgeById.get(edge.id));
      const source = positionedNodeById.get(edge.source);
      const target = positionedNodeById.get(edge.target);
      const points = source && target
        ? attachToExactPorts(
          rawPoints,
          getConnectionPoint(source, edge.sourcePin, "source"),
          getConnectionPoint(target, edge.targetPin, "target")
        )
        : rawPoints;
      return {
        ...edge,
        points,
        routeKind: "elk-orthogonal"
      };
    });
    const positionedEdges = placeWireLabels(routedEdges, positionedNodes, {
      order: "longest",
      minimumPadding: 32,
      baselineOffsets: [-5],
      checkCollisions: false,
      includeEmpty: true
    });
    const bounds = computeBounds(positionedNodes);
    const positionedGraph = {
      ...graph,
      nodes: positionedNodes,
      edges: positionedEdges,
      width: Math.max(result.width || 0, bounds.width),
      height: Math.max(result.height || 0, bounds.height),
      layoutProvider: this.id
    };
    return applyPositionedOverrides(positionedGraph, options);
  }
}

function toElkNode(node) {
  return {
    id: node.id,
    width: node.width,
    height: node.height,
    layoutOptions: { "elk.portConstraints": "FIXED_POS" },
    ports: node.ports.map((port) => ({
      id: elkPortId(node.id, port),
      width: 1,
      height: 1,
      x: port.x,
      y: port.y,
      layoutOptions: { "elk.port.side": port.side === "right" ? "EAST" : "WEST" }
    }))
  };
}

function toElkEdge(edge, nodeById) {
  const sourcePort = getPort(nodeById.get(edge.source), edge.sourcePin, "source");
  const targetPort = getPort(nodeById.get(edge.target), edge.targetPin, "target");
  return {
    id: edge.id,
    sources: [sourcePort ? elkPortId(edge.source, sourcePort) : edge.source],
    targets: [targetPort ? elkPortId(edge.target, targetPort) : edge.target]
  };
}

function elkPortId(nodeId, port) {
  return `${nodeId}::${port.direction}:${encodeURIComponent(port.rawPin || port.pin)}`;
}

function attachToExactPorts(points, start, end) {
  const rawStart = points[0] || start;
  const rawEnd = points.at(-1) || end;
  const direction = end.x >= start.x ? 1 : -1;
  const sourceTrunk = start.x + direction * 24;
  const targetTrunk = end.x - direction * 24;
  return compactOrthogonalPoints([
    start,
    { x: sourceTrunk, y: start.y },
    { x: sourceTrunk, y: rawStart.y },
    rawStart,
    ...points.slice(1, -1),
    rawEnd,
    { x: targetTrunk, y: rawEnd.y },
    { x: targetTrunk, y: end.y },
    end
  ]);
}

function getEdgePoints(edge) {
  const section = edge?.sections?.[0];
  if (!section) {
    return [{ x: 0, y: 0 }, { x: 0, y: 0 }];
  }
  return [section.startPoint, ...(section.bendPoints || []), section.endPoint]
    .map((point) => ({ x: point.x, y: point.y }));
}
