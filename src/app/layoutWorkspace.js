import { normalizeLayoutPolicy } from "../layout/layoutPolicy.js";
import { applyPositionedOverrides } from "../layout/positionedRouting.js";

export function layoutWorkspaceGraph(graph, options) {
  const layoutOptions = { layoutPolicy: options.layoutPolicy };
  const layoutResult = options.layoutProvider.layout(graph, layoutOptions);
  const finalize = (providerGraph) => {
    const autoGraph = addWorkspaceHeadroom(providerGraph, options.layoutPolicy);
    return ({
      autoGraph,
      graph: applyWorkspaceOverrides(autoGraph, {
        layoutPolicy: options.layoutPolicy,
        nodePositions: options.nodePositions,
        nodeSizes: options.nodeSizes
      })
    });
  };
  return isPromise(layoutResult) ? layoutResult.then(finalize) : finalize(layoutResult);
}

export function addWorkspaceHeadroom(graph, layoutPolicy) {
  const topPadding = normalizeLayoutPolicy(layoutPolicy).spacing.topPadding;
  if (!graph || topPadding <= 0) return graph;
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({ ...node, y: node.y + topPadding })),
    edges: graph.edges.map((edge) => ({
      ...edge,
      points: edge.points?.map((point) => ({ ...point, y: point.y + topPadding })),
      labelPoint: edge.labelPoint
        ? { ...edge.labelPoint, y: edge.labelPoint.y + topPadding }
        : edge.labelPoint
    })),
    height: Number(graph.height || 0) + topPadding
  };
}

export function applyWorkspaceOverrides(autoGraph, options = {}) {
  return applyPositionedOverrides(autoGraph, {
    layoutPolicy: options.layoutPolicy,
    nodePositions: options.nodePositions,
    nodeSizes: options.nodeSizes
  });
}

function isPromise(value) {
  return Boolean(value && typeof value.then === "function");
}
