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
    cellConfig = null,
    timing = null,
    timingDisplayPolicy = null,
    timingBadgeChoices = {},
    timingBadgePositions = {},
    showAliases = false,
    viewMode = "whole",
    coneRootNodeId = null,
    coneDepth = 3,
    faninDepth = 3,
    fanoutDepth = 3,
    useFanoutHubs = true,
    collapseLargeGroups = false,
    expandedGroupIds = new Set(),
    layoutProvider,
    layoutPolicy,
    nodePositions = new Map(),
    nodeSizes = new Map()
  } = options;
  const fullGraph = buildWorkspaceGraph(module, {
    moduleLibrary,
    graphOverrides,
    cellConfig,
    timing,
    timingDisplayPolicy,
    timingBadgeChoices,
    timingBadgePositions,
    showAliases
  });
  const sourceGraph = selectWorkspaceGraphView(fullGraph, {
    viewMode,
    rootNodeId: coneRootNodeId,
    maxDepth: coneDepth,
    faninDepth,
    fanoutDepth
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
