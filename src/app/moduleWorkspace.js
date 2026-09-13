import {
  applyWorkspaceGraphTransforms,
  buildWorkspaceGraph,
  selectWorkspaceGraphView
} from "./graphWorkspace.js";
import { runViewPipeline } from "../application/view_pipeline.js";
import { measureDiagramGraph } from "../diagram/measure_graph.js";
import { applyWorkspaceOverrides, layoutWorkspaceGraphAutomatically } from "./layoutWorkspace.js";
import { createNetlistScene } from "../domains/netlist/netlist_scene.js";

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
    focusedRootNetIds = null,
    activeFocusedRootNodeId = null,
    coneDepth = 3,
    faninDepth = 3,
    fanoutDepth = 3,
    useFanoutHubs = true,
    collapseLargeGroups = false,
    expandedGroupIds = new Set(),
    layoutProvider,
    layoutPolicy,
    presentationPolicy = null,
    nodePositions = new Map(),
    nodeSizes = new Map(),
    preparedFullGraph = null,
    occurrencePath = null
  } = options;
  const fullGraph = preparedFullGraph || buildWorkspaceGraph(module, {
    moduleLibrary,
    graphOverrides,
    cellConfig,
    timing,
    timingDisplayPolicy,
    timingBadgeChoices,
    timingBadgePositions,
    showAliases,
    occurrencePath
  });
  if (viewMode === "search-first") {
    const emptyGraph = selectWorkspaceGraphView(fullGraph, { viewMode: "search-first" });
    return {
      fullGraph,
      sourceGraph: emptyGraph,
      autoGraph: emptyGraph,
      graph: emptyGraph,
      scene: createNetlistScene(emptyGraph, { presentationPolicy })
    };
  }
  const pipeline = runViewPipeline({
    query: () => ({
      fullGraph,
      graph: selectWorkspaceGraphView(fullGraph, {
        viewMode,
        rootNodeIds: focusedRootNodeIds ?? coneRootNodeId,
        rootNetIds: focusedRootNetIds,
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
    createScene: (graph, request) => createNetlistScene(graph, {
      presentationPolicy: request.presentationPolicy
    })
  }, options);
  const finalize = (result) => ({
    fullGraph: result.queryResult.fullGraph,
    sourceGraph: result.diagram,
    autoGraph: result.autoGraph,
    graph: result.graph,
    scene: result.scene
  });
  return isPromise(pipeline) ? pipeline.then(finalize) : finalize(pipeline);
}

function isPromise(value) {
  return Boolean(value && typeof value.then === "function");
}
