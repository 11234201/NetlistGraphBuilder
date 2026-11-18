import { netlistPathIndex, addPathSideInputs } from "./show_path.js";
import { applyWorkspaceGraphTransforms, selectWorkspaceGraphView } from "./netlist_graph_projection.js";

// Domain query contract shared by DomainFeature and the cached product pipeline.
// Full-graph construction/caching and provider selection remain outside it.
export function queryNetlistView(fullGraph, query, transforms = {}) {
  const path = query.showPath?.enabled ? netlistPathIndex(fullGraph).query(query.showPath) : null;
  const pathGraph = path ? { ...fullGraph, nodes: fullGraph.nodes.filter((n) => path.nodeIds.has(n.id)),
    edges: fullGraph.edges.filter((e) => path.edgeIds.has(e.id)) } : fullGraph;
  const selectedGraph = selectWorkspaceGraphView(pathGraph, {
    viewMode: path && query.mode === "search-first" ? "whole" : query.mode,
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
    fullGraph, path,
    // Search-first is an indexed empty view, not a graph to simplify or route.
    visibleGraph: !path && query.mode === "search-first" ? selectedGraph
      : applyWorkspaceGraphTransforms(path ? addPathSideInputs(fullGraph, selectedGraph, path) : selectedGraph, { ...transforms, fullGraph,
        preserveLegacyProjection: query.preserveLegacyProjection === true })
  };
}
