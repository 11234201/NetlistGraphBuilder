import { applyPositionedOverrides } from "../layout/positionedRouting.js";
import {
  applyWorkspaceGraphTransforms,
  buildWorkspaceGraph,
  selectWorkspaceGraphView
} from "./graphWorkspace.js";

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

  const layoutOptions = { layoutPolicy };
  const layoutResult = layoutProvider.layout(displayGraph, layoutOptions);
  const finalize = (autoGraph) => ({
    fullGraph,
    autoGraph,
    graph: applyPositionedOverrides(autoGraph, {
      ...layoutOptions,
      nodePositions,
      nodeSizes
    })
  });
  return isPromise(layoutResult) ? layoutResult.then(finalize) : finalize(layoutResult);
}

function isPromise(value) {
  return Boolean(value && typeof value.then === "function");
}
