import { applyPositionedOverrides } from "../layout/positionedRouting.js";

export function layoutWorkspaceGraph(graph, options) {
  const layoutOptions = { layoutPolicy: options.layoutPolicy };
  const layoutResult = options.layoutProvider.layout(graph, layoutOptions);
  const finalize = (autoGraph) => ({
    autoGraph,
    graph: applyPositionedOverrides(autoGraph, {
      ...layoutOptions,
      nodePositions: options.nodePositions,
      nodeSizes: options.nodeSizes
    })
  });
  return isPromise(layoutResult) ? layoutResult.then(finalize) : finalize(layoutResult);
}

function isPromise(value) {
  return Boolean(value && typeof value.then === "function");
}
