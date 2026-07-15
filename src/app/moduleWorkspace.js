import {
  applyWorkspaceGraphTransforms,
  buildWorkspaceGraph,
  selectWorkspaceGraphView
} from "./graphWorkspace.js";
import { layoutWorkspaceGraph } from "./layoutWorkspace.js";

export function buildModuleWorkspace(options) {
  const {
    module,
    moduleLibrary = [],
    graphOverrides = null,
    timing = null,
    timingBadgeChoices = {},
    timingBadgePositions = {},
    showAliases = false,
    viewMode = "whole",
    coneRootNodeId = null,
    coneDepth = 3,
    useFanoutHubs = true,
    collapseLargeGroups = true,
    expandedGroupIds = new Set(),
    layoutProvider,
    layoutPolicy,
    nodePositions = new Map(),
    nodeSizes = new Map()
  } = options;
  const fullGraph = buildWorkspaceGraph(module, {
    moduleLibrary,
    graphOverrides,
    timing,
    timingBadgeChoices,
    timingBadgePositions,
    showAliases
  });
  const sourceGraph = selectWorkspaceGraphView(fullGraph, {
    viewMode,
    rootNodeId: coneRootNodeId,
    maxDepth: coneDepth
  });
  const displayGraph = applyWorkspaceGraphTransforms(sourceGraph, {
    useFanoutHubs,
    collapseLargeGroups,
    expandedGroupIds
  });

  const layoutResult = layoutWorkspaceGraph(displayGraph, {
    layoutProvider,
    layoutPolicy,
    nodePositions,
    nodeSizes
  });
  const finalize = (layout) => ({ fullGraph, ...layout });
  return isPromise(layoutResult) ? layoutResult.then(finalize) : finalize(layoutResult);
}

function isPromise(value) {
  return Boolean(value && typeof value.then === "function");
}
