import { normalizeLayoutPolicy } from "../layout/layoutPolicy.js";
import { applyPositionedOverrides } from "../layout/positionedRouting.js";
import { shiftWireRoutes } from "../layout/wireRoutes.js";

export function layoutWorkspaceGraph(graph, options) {
  const layoutResult = layoutWorkspaceGraphAutomatically(graph, options);
  const finalize = (autoGraph) => ({
      autoGraph,
      graph: applyWorkspaceOverrides(autoGraph, {
        layoutPolicy: options.layoutPolicy,
        nodePositions: options.nodePositions,
        nodeSizes: options.nodeSizes
      })
    });
  return isPromise(layoutResult) ? layoutResult.then(finalize) : finalize(layoutResult);
}

export function layoutWorkspaceGraphAutomatically(graph, options) {
  const layoutResult = options.layoutProvider.layout(graph, {
    layoutPolicy: options.layoutPolicy,
    signal: options.signal,
    jobId: options.jobId
  });
  const finalize = (providerGraph) => addWorkspaceHeadroom(providerGraph, options.layoutPolicy);
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
    wireRoutes: shiftWireRoutes(graph.wireRoutes, { y: topPadding }),
    height: Number(graph.height || 0) + topPadding
  };
}

export function applyWorkspaceOverrides(autoGraph, options = {}) {
  return applyPositionedOverrides(autoGraph, {
    layoutPolicy: options.layoutPolicy,
    nodePositions: options.nodePositions,
    nodeSizes: options.nodeSizes,
    validate: options.validate,
    expandNetGroups: options.expandNetGroups
  });
}

function isPromise(value) {
  return Boolean(value && typeof value.then === "function");
}
