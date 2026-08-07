import { normalizeGraphAliases } from "../analysis/aliasNormalizer.js";
import { simplifyFanoutWithHubs } from "../analysis/fanoutHub.js";
import { createConeGraph, createFocusedNeighborhoodGraph } from "../analysis/graphCone.js";
import { collapseLargeGraph } from "../analysis/groupCollapse.js";
import { buildSchematicGraph } from "../netlist/graph.js";
import { annotateGraphTiming } from "../timing/timingAnnotation.js";

export function buildWorkspaceGraph(module, options = {}) {
  const graph = buildSchematicGraph(module, {
    overrides: options.graphOverrides,
    moduleLibrary: options.moduleLibrary || [],
    cellConfig: options.cellConfig
  });
  const annotatedGraph = annotateGraphTiming(graph, options.timing, {
    displayPolicy: options.timingDisplayPolicy,
    badgeChoices: options.timingBadgeChoices || {},
    badgePositions: options.timingBadgePositions || {}
  });
  return normalizeGraphAliases(annotatedGraph, { showAliases: options.showAliases === true });
}

export function selectWorkspaceGraphView(fullGraph, options = {}) {
  if (options.viewMode === "search-first") {
    return {
      ...fullGraph,
      nodes: [],
      edges: [],
      view: { mode: "search-first", totalNodes: fullGraph.nodes.length }
    };
  }
  if (!options.viewMode || options.viewMode === "whole") return fullGraph;
  if (options.viewMode === "focused") {
    return createFocusedNeighborhoodGraph(fullGraph, options.rootNodeId, {
      faninDepth: options.faninDepth,
      fanoutDepth: options.fanoutDepth
    });
  }
  return createConeGraph(fullGraph, options.rootNodeId, {
    direction: options.viewMode,
    maxDepth: options.maxDepth ?? 3
  });
}

export function shouldUseSearchFirst(value, threshold = 500) {
  const count = Array.isArray(value?.nodes)
    ? value.nodes.length
    : Array.isArray(value?.cells) ? value.cells.length : 0;
  const limit = Number.isFinite(Number(threshold)) ? Math.max(1, Math.floor(Number(threshold))) : 500;
  return count > limit;
}

export function resolveCellConfigRefreshView({ module, fullGraph, selectedNodeId, viewMode }, threshold = 500) {
  if (!shouldUseSearchFirst(module, threshold)) {
    return { viewMode, coneRootNodeId: null };
  }
  const selected = fullGraph?.nodes?.find((node) => node.id === selectedNodeId);
  if (selected?.kind === "cell") {
    return { viewMode: "focused", coneRootNodeId: selectedNodeId };
  }
  return { viewMode: "search-first", coneRootNodeId: null };
}

export function applyWorkspaceGraphTransforms(graph, options = {}) {
  let result = graph;
  if (options.useFanoutHubs !== false) result = simplifyFanoutWithHubs(result);
  if (options.collapseLargeGroups !== false) {
    result = collapseLargeGraph(result, {
      expandedGroupIds: options.expandedGroupIds || new Set()
    });
  }
  return result;
}
