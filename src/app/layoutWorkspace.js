import { applyPositionedOverrides } from "../layout/positionedRouting.js";

export function layoutWorkspaceGraph(graph, options) {
  const layoutOptions = { layoutPolicy: options.layoutPolicy };
  const layoutResult = options.layoutProvider.layout(graph, layoutOptions);
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
