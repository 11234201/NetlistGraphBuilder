import { buildWorkspaceGraph } from "../domains/netlist/netlist_graph_projection.js";
import { queryNetlistView } from "../domains/netlist/netlist_view_query.js";
import { runViewPipeline } from "../application/view_pipeline.js";
import { measureDiagramGraph } from "../diagram/measure_graph.js";
import { measureNetlistGraph } from "../domains/netlist/measure_graph.js";
import { MEASURED_GRAPH_CONTRACT } from "../contracts/measured_graph.js";
import { applyWorkspaceOverrides, layoutWorkspaceGraphAutomatically } from "./layoutWorkspace.js";
import { createNetlistScene } from "../domains/netlist/netlist_scene.js";
import { normalizeNetlistPresentationPolicy } from "../domains/netlist/netlist_presentation_policy.js";
import { createWorkspaceArtifactKey, workspaceArtifactReference } from "./workspaceArtifactCache.js";
import { DEFAULT_FOCUSED_VIEW_POLICY } from "../foundation/view_policy.js";
import { DEFAULT_LAYOUT_PROVIDER_ID } from "../layout/providerDefaults.js";

// A cached positioned graph can outlive its canvas. Retain only a weak reference to the scene.
const positionedScenes = new WeakMap();

function workspaceScene(graph, presentationPolicy, reusable) {
  if (!reusable || typeof WeakRef !== "function") return createNetlistScene(graph, { presentationPolicy });
  const policyKey = createWorkspaceArtifactKey(normalizeNetlistPresentationPolicy(presentationPolicy));
  const previous = positionedScenes.get(graph);
  const scene = previous?.policyKey === policyKey ? previous.ref.deref() : null;
  if (scene) return scene;
  const next = createNetlistScene(graph, { presentationPolicy });
  positionedScenes.set(graph, { policyKey, ref: new WeakRef(next) });
  return next;
}

export function buildModuleWorkspace(options) {
  const {
    module,
    moduleLibrary = [],
    graphOverrides = null,
    cellConfig = null,
    cellLibrary = null,
    timing = null,
    timingDisplayPolicy = null,
    timingBadgeChoices = {},
    timingBadgePositions = {},
    showAliases = false,
    preserveLegacyProjection = false,
    viewMode = "whole",
    coneRootNodeId = null,
    focusedRootNodeIds = null,
    focusedRootNetIds = null,
    activeFocusedRootNodeId = null,
    coneDepth = 3,
    faninDepth = 3,
    fanoutDepth = 3,
    maximumVisibleNodes = DEFAULT_FOCUSED_VIEW_POLICY.maximumVisibleNodes,
    maximumFrontier = DEFAULT_FOCUSED_VIEW_POLICY.maximumFrontier,
    useFanoutHubs = true,
    layoutProvider,
    layoutPolicy,
    presentationPolicy = null,
    nodePositions = new Map(),
    nodeSizes = new Map(),
    preparedFullGraph = null,
    occurrenceRootModuleName = null,
    occurrencePath = null,
    artifactCache = null,
    artifactIdentity = null
  } = options;
  const fullGraph = preparedFullGraph || buildModuleFullGraph({
    module,
    moduleLibrary,
    graphOverrides,
    cellConfig,
    cellLibrary,
    timing,
    timingDisplayPolicy,
    timingBadgeChoices,
    timingBadgePositions,
    showAliases,
    occurrenceRootModuleName,
    occurrencePath,
    reuseWhileReferenced: layoutProvider?.id === DEFAULT_LAYOUT_PROVIDER_ID,
    artifactCache,
    artifactIdentity
  });
  if (viewMode === "search-first" && !options.showPath?.enabled) {
    const { visibleGraph: emptyGraph } = queryNetlistView(fullGraph, { mode: "search-first" });
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
    showPath: options.showPath?.enabled ? options.showPath : null,
    fullGraph: workspaceArtifactReference(fullGraph),
    providerInstance: workspaceArtifactReference(layoutProvider),
    moduleName: module?.name || null,
    preserveLegacyProjection,
    viewMode,
    coneRootNodeId,
    focusedRootNodeIds,
    focusedRootNetIds,
    activeFocusedRootNodeId,
    coneDepth,
    faninDepth,
    fanoutDepth,
    maximumVisibleNodes,
    maximumFrontier,
    useFanoutHubs,
    unroutedNets: graphOverrides?.unroutedNets,
    layoutProvider: layoutProvider?.id || null,
    layoutPolicy
  };
  const cachedPipeline = artifactCache && autoIdentity
    ? artifactCache.get(createWorkspaceArtifactKey(autoIdentity))
    : null;
  const reuseScene = artifactCache && autoIdentity && layoutProvider?.id === DEFAULT_LAYOUT_PROVIDER_ID;
  if (cachedPipeline) {
    const graph = applyWorkspaceOverrides(cachedPipeline.autoGraph, {
      layoutPolicy,
      nodePositions,
      nodeSizes,
      // A cached auto graph already has provider diagnostics. Local routing
      // checks the changed candidates; a full graph validation would scan all
      // unchanged edges again and dominates large mapped cases.
      validate: cachedPipeline.autoGraph.layoutStatus === "routed" ? false : true,
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
      scene: workspaceScene(graph, presentationPolicy, reuseScene)
    };
  }
  const pipeline = runViewPipeline({
    query: () => queryNetlistView(fullGraph, {
      mode: viewMode,
      showPath: options.showPath,
      rootNodeIds: focusedRootNodeIds ?? coneRootNodeId,
      rootNetIds: focusedRootNetIds,
      rootNodeId: coneRootNodeId,
      activeRootNodeId: activeFocusedRootNodeId,
      maxDepth: coneDepth,
      faninDepth,
      fanoutDepth,
      maximumVisibleNodes,
      maximumFrontier,
      // Simple's source projection is frozen along with its geometry.
      preserveLegacyProjection: preserveLegacyProjection || layoutProvider?.id === "simple-layered"
    }, {
      unroutedNets: graphOverrides?.unroutedNets,
      useFanoutHubs,
    }),
    project: (result) => result.visibleGraph,
    measure: (graph) => layoutProvider?.measurementContract === MEASURED_GRAPH_CONTRACT
      ? measureNetlistGraph(graph, { cellPinPitch: layoutPolicy?.spacing?.cellPinPitch,
        focusedOrderGroups: layoutProvider.id === "native-layered" })
      : measureDiagramGraph(graph, { cellPinPitch: layoutPolicy?.spacing?.cellPinPitch }),
    layout: (graph) => layoutWorkspaceGraphAutomatically(graph, {
      layoutProvider, layoutPolicy, signal: options.signal, jobId: options.jobId
    }),
    applyOverrides: (autoGraph) => applyWorkspaceOverrides(autoGraph, { layoutPolicy, nodePositions, nodeSizes }),
    createScene: (graph, request) => workspaceScene(graph, request.presentationPolicy, reuseScene)
  }, options);
  const finalize = (result) => {
    const cached = {
      sourceGraph: result.diagram,
      autoGraph: withPath(result.autoGraph, result.queryResult.path)
    };
    if (artifactCache && autoIdentity) artifactCache.put(
      createWorkspaceArtifactKey(autoIdentity),
      cached,
      { documentId: artifactIdentity.documentId, sessionId: artifactIdentity.sessionId }
    );
    return {
      fullGraph: result.queryResult.fullGraph,
      sourceGraph: result.diagram,
      autoGraph: cached.autoGraph,
      graph: withPath(result.graph, result.queryResult.path),
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
    cellLibrary = null,
    timing = null,
    timingDisplayPolicy = null,
    timingBadgeChoices = {},
    timingBadgePositions = {},
    showAliases = false,
    occurrenceRootModuleName = null,
    occurrencePath = null,
    reuseWhileReferenced = false,
    artifactCache = null,
    artifactIdentity = null
  } = options;
  const identity = artifactIdentity && {
    ...artifactIdentity,
    stage: "full-graph",
    moduleName: module?.name || null,
    graphOverrides,
    cellConfig,
    cellLibrary: workspaceArtifactReference(cellLibrary),
    timing,
    timingDisplayPolicy,
    timingBadgeChoices,
    timingBadgePositions,
    showAliases,
    occurrenceRootModuleName,
    occurrencePath
  };
  const key = identity ? createWorkspaceArtifactKey(identity) : null;
  const cached = artifactCache && key ? artifactCache.get(key, { reuseWhileReferenced }) : null;
  if (cached) return cached;
  const graph = buildWorkspaceGraph(module, {
    moduleLibrary,
    graphOverrides,
    cellConfig,
    cellLibrary,
    timing,
    timingDisplayPolicy,
    timingBadgeChoices,
    timingBadgePositions,
    showAliases,
    occurrenceRootModuleName,
    occurrencePath
  });
  if (artifactCache && key) artifactCache.put(key, graph, {
    reuseWhileReferenced, documentId: artifactIdentity.documentId,
    sessionId: artifactIdentity.sessionId
  });
  return graph;
}

function withPath(graph, path) {
  return path ? { ...graph, path, pathEdgeIds: path.edgeIds } : graph;
}

function isPromise(value) {
  return Boolean(value && typeof value.then === "function");
}
