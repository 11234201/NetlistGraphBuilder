import {
  applyWorkspaceGraphTransforms,
  buildWorkspaceGraph,
  selectWorkspaceGraphView
} from "./graphWorkspace.js";
import { createIdentityStage, runViewPipeline } from "../application/view_pipeline.js";
import { measureDiagramGraph } from "../diagram/measure_graph.js";
import { applyWorkspaceOverrides, layoutWorkspaceGraphAutomatically } from "./layoutWorkspace.js";

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
    focusedRootNodeIds = null,
    activeFocusedRootNodeId = null,
    coneDepth = 3,
    faninDepth = 3,
    fanoutDepth = 3,
    useFanoutHubs = true,
    collapseLargeGroups = false,
    expandedGroupIds = new Set(),
    layoutProvider,
    layoutPolicy,
    nodePositions = new Map(),
    nodeSizes = new Map(),
    preparedFullGraph = null
  } = options;
  const fullGraph = preparedFullGraph || buildWorkspaceGraph(module, {
    moduleLibrary,
    graphOverrides,
    cellConfig,
    timing,
    timingDisplayPolicy,
    timingBadgeChoices,
    timingBadgePositions,
    showAliases
  });
  const pipeline = runViewPipeline({
    query: () => ({
      fullGraph,
      graph: selectWorkspaceGraphView(fullGraph, {
        viewMode,
        rootNodeIds: focusedRootNodeIds ?? coneRootNodeId,
        rootNodeId: coneRootNodeId,
        activeRootNodeId: activeFocusedRootNodeId,
        maxDepth: coneDepth,
        faninDepth,
        fanoutDepth
      })
    }),
    project: (result) => applyWorkspaceGraphTransforms(result.graph, {
      useFanoutHubs,
      collapseLargeGroups,
      expandedGroupIds
    }),
    measure: (graph) => measureDiagramGraph(graph, { cellPinPitch: layoutPolicy?.spacing?.cellPinPitch }),
    layout: (graph) => layoutWorkspaceGraphAutomatically(graph, { layoutProvider, layoutPolicy }),
    applyOverrides: (autoGraph) => applyWorkspaceOverrides(autoGraph, { layoutPolicy, nodePositions, nodeSizes }),
    createScene: createIdentityStage()
  }, options);
  const finalize = (result) => ({
    fullGraph: result.queryResult.fullGraph,
    sourceGraph: result.diagram,
    autoGraph: result.autoGraph,
    graph: result.graph
  });
  return isPromise(pipeline) ? pipeline.then(finalize) : finalize(pipeline);
}

function isPromise(value) {
  return Boolean(value && typeof value.then === "function");
}
