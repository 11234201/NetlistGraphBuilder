import { normalizeGraphAliases } from "../analysis/aliasNormalizer.js";
import { simplifyFanoutWithHubs } from "../analysis/fanoutHub.js";
import { createConeGraph } from "../analysis/graphCone.js";
import { collapseLargeGraph } from "../analysis/groupCollapse.js";
import { buildSchematicGraph } from "../netlist/graph.js";
import { annotateGraphTiming } from "../timing/timingAnnotation.js";

export function buildWorkspaceGraph(module, options = {}) {
  const graph = buildSchematicGraph(module, {
    overrides: options.graphOverrides,
    moduleLibrary: options.moduleLibrary || []
  });
  const annotatedGraph = annotateGraphTiming(graph, options.timing, {
    badgeChoices: options.timingBadgeChoices || {},
    badgePositions: options.timingBadgePositions || {}
  });
  return normalizeGraphAliases(annotatedGraph, { showAliases: options.showAliases === true });
}

export function selectWorkspaceGraphView(fullGraph, options = {}) {
  if (!options.viewMode || options.viewMode === "whole") return fullGraph;
  return createConeGraph(fullGraph, options.rootNodeId, {
    direction: options.viewMode,
    maxDepth: options.maxDepth ?? 3
  });
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
