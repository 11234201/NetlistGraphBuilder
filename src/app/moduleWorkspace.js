import {
  applyWorkspaceGraphTransforms,
  buildWorkspaceGraph,
  selectWorkspaceGraphView
} from "./graphWorkspace.js";
import { runViewPipeline } from "../application/view_pipeline.js";
import { measureDiagramGraph } from "../diagram/measure_graph.js";
import { applyWorkspaceOverrides, layoutWorkspaceGraphAutomatically } from "./layoutWorkspace.js";
import { createNetlistScene } from "../domains/netlist/netlist_scene.js";
import { analyzeHierarchicalCones, projectHierarchicalRenderGraph } from "../domains/netlist/hierarchy_connectivity.js";
import { createWorkspaceArtifactKey } from "./workspaceArtifactCache.js";

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
    occurrencePath = null,
    hierarchyRoot = null,
    hierarchyRoots = null,
    artifactCache = null,
    artifactIdentity = null
  } = options;
  let fullGraph = preparedFullGraph || buildModuleFullGraph({
    module,
    moduleLibrary,
    graphOverrides,
    cellConfig,
    timing,
    timingDisplayPolicy,
    timingBadgeChoices,
    timingBadgePositions,
    showAliases,
    occurrencePath,
    artifactCache,
    artifactIdentity
  });
  const resolvedHierarchyRoots = hierarchyRoots?.length ? hierarchyRoots : (hierarchyRoot ? [hierarchyRoot] : []);
  if (!preparedFullGraph && resolvedHierarchyRoots.length > 0 && moduleLibrary.length > 0 && viewMode === "focused") {
    const hierarchyIdentity = artifactIdentity && {
      ...artifactIdentity,
      stage: "hierarchical-cone",
      hierarchyRoots: resolvedHierarchyRoots,
      faninDepth,
      fanoutDepth
    };
    const hierarchyKey = hierarchyIdentity ? createWorkspaceArtifactKey(hierarchyIdentity) : null;
    const cachedHierarchy = artifactCache && hierarchyKey ? artifactCache.get(hierarchyKey) : null;
    if (cachedHierarchy) {
      fullGraph = cachedHierarchy;
    } else {
      const result = analyzeHierarchicalCones({ modules: moduleLibrary }, resolvedHierarchyRoots, {
        faninDepth,
        fanoutDepth,
        maximumVisibleNodes: 512,
        maximumFrontier: 1024
      });
      fullGraph = projectHierarchicalRenderGraph(result, {
        documentId: artifactIdentity?.documentId || "hierarchy:workspace"
      });
      if (artifactCache && hierarchyKey) artifactCache.put(hierarchyKey, fullGraph, {
        documentId: artifactIdentity?.documentId,
        sessionId: artifactIdentity?.sessionId
      });
    }
  }
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
  const autoIdentity = artifactIdentity && {
    ...artifactIdentity,
    stage: "positioned-auto",
    moduleName: module?.name || null,
    viewMode,
    coneRootNodeId,
    focusedRootNodeIds,
    focusedRootNetIds,
    activeFocusedRootNodeId,
    coneDepth,
    faninDepth,
    fanoutDepth,
    useFanoutHubs,
    collapseLargeGroups,
    expandedGroupIds: [...expandedGroupIds],
    layoutProvider: layoutProvider?.id || null,
    layoutPolicy
  };
  const cachedPipeline = artifactCache && autoIdentity
    ? artifactCache.get(createWorkspaceArtifactKey(autoIdentity))
    : null;
  if (cachedPipeline) {
    const graph = applyWorkspaceOverrides(cachedPipeline.autoGraph, {
      layoutPolicy,
      nodePositions,
      nodeSizes,
      // A cached auto graph already has provider diagnostics. Local routing
      // checks the changed candidates; a full graph validation would scan all
      // unchanged edges again and dominates large mapped cases.
      validate: false,
      // Reroute only edges whose endpoint/path is actually invalidated;
      // updateWireRoutes still rebuilds the affected net group from all edges.
      // The cached graph keeps its prior provider status/diagnostics; a later
      // explicit full rebuild remains the authoritative validation boundary.
      expandNetGroups: false
    });
    return {
      fullGraph,
      sourceGraph: cachedPipeline.sourceGraph,
      autoGraph: cachedPipeline.autoGraph,
      graph,
      scene: createNetlistScene(graph, { presentationPolicy })
    };
  }
  const pipeline = runViewPipeline({
    query: () => ({
      fullGraph,
      graph: resolvedHierarchyRoots.length > 0 ? fullGraph : selectWorkspaceGraphView(fullGraph, {
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
  const finalize = (result) => {
    const cached = {
      sourceGraph: result.diagram,
      autoGraph: result.autoGraph
    };
    if (artifactCache && autoIdentity) artifactCache.put(
      createWorkspaceArtifactKey(autoIdentity),
      cached,
      { documentId: artifactIdentity.documentId, sessionId: artifactIdentity.sessionId }
    );
    return {
      fullGraph: result.queryResult.fullGraph,
      sourceGraph: result.diagram,
      autoGraph: result.autoGraph,
      graph: result.graph,
      scene: result.scene
    };
  };
  return isPromise(pipeline) ? pipeline.then(finalize) : finalize(pipeline);
}

export function buildModuleFullGraph(options = {}) {
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
    occurrencePath = null,
    artifactCache = null,
    artifactIdentity = null
  } = options;
  const identity = artifactIdentity && {
    ...artifactIdentity,
    stage: "full-graph",
    moduleName: module?.name || null,
    graphOverrides,
    cellConfig,
    timing,
    timingDisplayPolicy,
    timingBadgeChoices,
    timingBadgePositions,
    showAliases,
    occurrencePath
  };
  const key = identity ? createWorkspaceArtifactKey(identity) : null;
  const cached = artifactCache && key ? artifactCache.get(key) : null;
  if (cached) return cached;
  const graph = buildWorkspaceGraph(module, {
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
  if (artifactCache && key) artifactCache.put(key, graph, {
    documentId: artifactIdentity.documentId,
    sessionId: artifactIdentity.sessionId
  });
  return graph;
}

function isPromise(value) {
  return Boolean(value && typeof value.then === "function");
}
