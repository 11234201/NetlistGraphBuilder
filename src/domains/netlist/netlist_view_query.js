import { applyWorkspaceGraphTransforms, selectWorkspaceGraphView } from "./netlist_graph_projection.js";

// Domain query contract shared by DomainFeature and the cached product pipeline.
// Full-graph construction/caching and provider selection remain outside it.
export function queryNetlistView(fullGraph, query, transforms = {}) {
  const selectedGraph = selectWorkspaceGraphView(fullGraph, {
    viewMode: query.mode,
    rootNodeIds: query.rootNodeIds,
    rootNetIds: query.rootNetIds,
    rootNodeId: query.rootNodeId,
    activeRootNodeId: query.activeRootNodeId,
    maxDepth: query.maxDepth,
    faninDepth: query.faninDepth,
    fanoutDepth: query.fanoutDepth,
    maximumVisibleNodes: query.maximumVisibleNodes,
    maximumFrontier: query.maximumFrontier,
    preserveLegacyProjection: query.preserveLegacyProjection === true
  });
  return {
    fullGraph,
    // Search-first is an indexed empty view, not a graph to simplify or route.
    visibleGraph: query.mode === "search-first" ? selectedGraph
      : applyWorkspaceGraphTransforms(selectedGraph, { ...transforms, fullGraph })
  };
}
