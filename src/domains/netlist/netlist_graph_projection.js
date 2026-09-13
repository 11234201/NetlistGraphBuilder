import { normalizeGraphAliases } from "../../analysis/aliasNormalizer.js";
import { simplifyFanoutWithHubs } from "../../analysis/fanoutHub.js";
import { createFocusedNeighborhoodGraph } from "../../analysis/graphCone.js";
import { collapseLargeGraph } from "../../analysis/groupCollapse.js";
import { projectFocusedBoundaries } from "../../analysis/focusBoundary.js";
import { normalizeFocusedRootIds, normalizeViewMode } from "../../foundation/view_policy.js";
import { buildSchematicGraph } from "../../netlist/graph.js";
import { annotateGraphTiming } from "../../timing/timingAnnotation.js";

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
  const viewMode = normalizeViewMode(options.viewMode);
  if (viewMode === "search-first") {
    return { ...fullGraph, nodes: [], edges: [], view: { mode: "search-first", totalNodes: fullGraph.nodes.length } };
  }
  if (viewMode === "whole") return fullGraph;
  if (viewMode === "focused") {
    const requestedRootIds = options.rootNodeIds === undefined ? options.rootNodeId : options.rootNodeIds;
    const roots = Array.isArray(requestedRootIds) ? requestedRootIds : requestedRootIds ? [requestedRootIds] : [];
    const encodedNetRoots = roots.filter((id) => typeof id === "string" && id.startsWith("net:"));
    const rootNodeIds = roots.filter((id) => !(typeof id === "string" && id.startsWith("net:")));
    return projectFocusedBoundaries(createFocusedNeighborhoodGraph(fullGraph, rootNodeIds, {
      rootNodeIds,
      rootNetIds: options.rootNetIds || encodedNetRoots.map((id) => id.slice(4)),
      activeRootNodeId: options.activeRootNodeId,
      faninDepth: options.faninDepth,
      fanoutDepth: options.fanoutDepth,
      maximumVisibleNodes: options.maximumVisibleNodes,
      maximumFrontier: options.maximumFrontier
    }));
  }
  return fullGraph;
}

export function shouldUseSearchFirst(value, threshold = 500) {
  const count = Array.isArray(value?.nodes) ? value.nodes.length : Array.isArray(value?.cells) ? value.cells.length : 0;
  const limit = Number.isFinite(Number(threshold)) ? Math.max(1, Math.floor(Number(threshold))) : 500;
  return count > limit;
}

export function resolveCellConfigRefreshView({ module, fullGraph, selectedNodeId, viewMode, focusedRootNodeIds, coneRootNodeId }, threshold = 500) {
  if (!shouldUseSearchFirst(module, threshold)) return { viewMode: normalizeViewMode(viewMode), coneRootNodeId: null };
  const selected = fullGraph?.nodes?.find((node) => node.id === selectedNodeId);
  if (selected?.kind === "cell") {
    const rootNodeIds = normalizeFocusedRootIds(focusedRootNodeIds, coneRootNodeId);
    const result = { viewMode: "focused", coneRootNodeId: rootNodeIds[0] || selectedNodeId };
    if (rootNodeIds.length > 1) result.rootNodeIds = rootNodeIds;
    return result;
  }
  return { viewMode: "search-first", coneRootNodeId: null };
}

export function applyWorkspaceGraphTransforms(graph, options = {}) {
  let result = graph;
  if (options.useFanoutHubs !== false) result = simplifyFanoutWithHubs(result);
  if (options.collapseLargeGroups === true) result = collapseLargeGraph(result, { expandedGroupIds: options.expandedGroupIds || new Set() });
  return result;
}
