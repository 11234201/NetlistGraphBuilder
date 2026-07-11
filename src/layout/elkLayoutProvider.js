import { buildNodePorts, computeBounds, measureNode } from "./nodeGeometry.js";

export const ELK_LAYOUT_PROVIDER_ID = "elk-layered";

export class ElkLayoutProvider {
  constructor(options = {}) {
    this.id = ELK_LAYOUT_PROVIDER_ID;
    this.label = "ELK Layered";
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
      return { ...node, width: override?.width || measured.width, height: override?.height || measured.height };
    });
    const elkGraph = {
      id: "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.spacing.nodeNode": "48",
        "elk.layered.spacing.nodeNodeBetweenLayers": "100",
        "elk.edgeRouting": "ORTHOGONAL"
      },
      children: measuredNodes.map((node) => ({ id: node.id, width: node.width, height: node.height })),
      edges: graph.edges.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] }))
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
    const positionedEdges = graph.edges.map((edge) => {
      const points = getEdgePoints(elkEdgeById.get(edge.id));
      return {
        ...edge,
        points,
        labelPoint: points[Math.floor(points.length / 2)] || { x: 0, y: 0 },
        labelAnchor: "start",
        routeKind: "elk-orthogonal"
      };
    });
    const bounds = computeBounds(positionedNodes);
    return {
      ...graph,
      nodes: positionedNodes,
      edges: positionedEdges,
      width: Math.max(result.width || 0, bounds.width),
      height: Math.max(result.height || 0, bounds.height),
      layoutProvider: this.id
    };
  }
}

function getEdgePoints(edge) {
  const section = edge?.sections?.[0];
  if (!section) {
    return [{ x: 0, y: 0 }, { x: 0, y: 0 }];
  }
  return [section.startPoint, ...(section.bendPoints || []), section.endPoint]
    .map((point) => ({ x: point.x, y: point.y }));
}
