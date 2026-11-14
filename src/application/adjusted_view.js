import { applyPositionedOverrides } from "../layout/positionedRouting.js";

// Rebuild a manually adjusted view from its immutable automatic layout. This
// use case has no provider, DOM, history or persistence dependency.
export function buildAdjustedView(autoGraph, { layoutPolicy, nodePositions, nodeSizes, createScene }) {
  const graph = applyPositionedOverrides(autoGraph, { layoutPolicy, nodePositions, nodeSizes });
  return { graph, scene: createScene(graph) };
}
