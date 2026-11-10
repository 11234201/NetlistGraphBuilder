import { createSingleWorkspaceInput } from "./workspace_inputs.js";
import { buildModuleWorkspace } from "./moduleWorkspace.js";
import { cancelSchematicRender, renderSvgSceneIntoMount } from "../render/progressiveSvgRenderer.js";
import { listLayoutProviders, getLayoutProvider } from "../layout/layoutProvider.js";
import { escapeAttr, escapeHtml } from "../ui/html.js";
import { getNextLayoutProviderId } from "../layout/providerDefaults.js";
import { createSingleWorkspaceIdentity } from "./workspace_identity.js";

// Legacy workbench adapter. State and elements are restricted ports supplied
// by the composition root; peer actions are explicit, late-bound services.
export function createWorkspaceRenderController({ state, elements, services }) {
  function renderCurrentModuleGraph(options = {}) {
    const request = services.renderGeneration.begin();
    state.singleWorkspaceIdentity = null;
    const requestId = request.id;
    const layoutProvider = services.getCurrentLayoutProvider();
    services.logProcess("debug", "graph", `Building ${state.currentModule?.displayName || "module"} graph`, {
      viewMode: state.viewMode,
      provider: layoutProvider.id
    });
    const workspaceOptions = createSingleWorkspaceInput(state, layoutProvider, services.readCellLibrary?.());
    const workspaceIdentity = createSingleWorkspaceIdentity(state, services.readCellLibrary?.());
    const isCurrentSingleRequest = () => request.isCurrent() && !state.compare.active;
    services.workspaceExecution.execute({
      provider: layoutProvider,
      tasks: [{
        beginComputation: () => services.singleViewSession.beginComputation(),
        kind: "single-workspace",
        run: (context) => buildModuleWorkspace({
          ...workspaceOptions, signal: context.signal, jobId: context.jobId
        })
      }],
      onStarted([job]) {
        services.logProcess("info", "layout", `Layout started (${layoutProvider.label})`, { requestId, jobId: job.context.jobId });
        services.setStatus(`Layout (${layoutProvider.label})…`);
      },
      onCommit: ([result]) => {
        if (isCurrentSingleRequest()) commitCurrentWorkspace(result.artifact.value, { ...options, workspaceIdentity });
      },
      onSettled: (results) => {
        if (results.some((result) => result.status !== "committed") || !isCurrentSingleRequest()) {
          options.onCancelled?.();
        }
      },
      onError: (error) => {
        if (isCurrentSingleRequest()) handleLayoutFailure(error, options);
        else options.onCancelled?.();
      }
    });
  }

  function commitCurrentWorkspace(workspace, options = {}) {
    state.compare.singleWorkspaceInvalidated = false;
    state.fullGraph = workspace.fullGraph;
    state.scene = workspace.scene;
    services.logProcess("info", "layout", `Layout completed: ${workspace.graph.nodes.length} node(s), ${workspace.graph.edges.length} edge(s)`, {
      fullNodes: workspace.fullGraph.nodes.length,
      viewMode: workspace.graph.view?.mode || state.viewMode
    });
    commitCurrentGraph(workspace.autoGraph, workspace.graph, { ...options, scene: workspace.scene });
  }

  function commitCurrentGraph(autoGraph, graph, options = {}) {
    const { readyMessage = null, onRendered = null, scene = null } = options;
    state.autoGraph = autoGraph;
    state.graph = graph;
    services.renderStats();
    services.renderDiagnostics();
    const renderRequest = services.renderGeneration.current();
    renderGraphMount(elements.mount, graph, { scene }).then((result) => {
      if (result?.cancelled) { options.onCancelled?.(); return; }
      state.singleWorkspaceIdentity = options.workspaceIdentity || null;
      services.applyTransform();
      services.setStatus(readyMessage || `Ready (${services.getCurrentLayoutProvider().label})`);
      services.updateCalibrationControls();
      onRendered?.(graph);
    }).catch((error) => {
      if (!renderRequest.isCurrent() || state.compare.active) {
        options.onCancelled?.();
        return;
      }
      services.logProcess("error", "render", `Render failed: ${error.message}`);
      services.setStatus(`Render failed: ${error.message}`);
      options.onFailed?.(error);
    });
    services.updateCalibrationControls();
    services.updateViewControls();
    services.persistSession();
  }

  function renderGraphMount(mount, graph, renderOptions = {}) {
    const request = services.renderGeneration.current();
    if (graph?.view?.mode === "search-first") {
      cancelSchematicRender(mount);
      mount.innerHTML = `<div class="search-first-empty"><strong>Search-first mode</strong><span>${Number(graph.view.totalNodes) || 0} nodes are indexed. Search for a cell to open its focused neighborhood, or choose Whole for an explicit overview.</span></div>`;
      return Promise.resolve().then(() => ({ cancelled: !request.isCurrent() }));
    }
    if (!renderOptions.scene) {
      return Promise.reject(new Error("Graph mount requires a prepared scene"));
    }
    return renderSvgSceneIntoMount(mount, renderOptions.scene, {
      ...renderOptions,
      isCurrent: request.isCurrent,
      onProgress: (progress) => {
        if (!request.isCurrent()) return;
        const { phase, rendered, total } = progress;
        if (phase === "render") {
          services.setStatus(`Rendering ${rendered}/${total}…`);
          services.logProcess("debug", "render", `Rendering ${rendered}/${total}`, { rendered, total }, { progressKey: "svg-batch" });
        }
        renderOptions.onProgress?.(progress);
      }
    }).then((result) => request.isCurrent() ? result : { ...result, cancelled: true });
  }

  function renderLayoutProviderOptions() {
    elements.layoutProviderSelect.innerHTML = listLayoutProviders()
      .map((provider) => `<option value="${escapeAttr(provider.id)}">${escapeHtml(provider.label)}</option>`)
      .join("");
    elements.layoutProviderSelect.value = state.layoutProviderId;
  }

  function handleLayoutProviderChange(event) {
    state.layoutFallbackFromProviderId = null;
    state.layoutProviderId = event.target.value;
    services.setSingleTransform({ x: 0, y: 0, scale: 1 });
    if (getLayoutProvider(state.layoutProviderId).experimental) {
      services.setStatus(`${getLayoutProvider(state.layoutProviderId).label}; Simple Layered is recommended for schematic editing`);
    }
    if (state.compare.active) services.renderCompareGraphs();
    else renderCurrentModuleGraph();
    services.persistSession();
  }

  function handleLayoutFailure(error, options = {}) {
    if (error?.name === "AbortError") { options.onCancelled?.(); return; }
    const failedProvider = getLayoutProvider(state.layoutProviderId);
    const nextProviderId = getNextLayoutProviderId(state.layoutProviderId);
    if (!nextProviderId) {
      services.logProcess("error", "layout", `${failedProvider.label} failed; no fallback remains: ${error.message}`);
      services.setStatus(`Layout failed: ${error.message}`);
      options.onFailed?.(error);
      return;
    }
    const nextProvider = getLayoutProvider(nextProviderId);
    services.logProcess("error", "layout", `${failedProvider.label} failed; falling back to ${nextProvider.label}: ${error.message}`);
    state.layoutFallbackFromProviderId ||= state.layoutProviderId;
    state.layoutProviderId = nextProviderId;
    elements.layoutProviderSelect.value = state.layoutProviderId;
    services.setStatus(`Layout failed; trying ${nextProvider.label}: ${error.message}`);
    if (state.compare.active) services.renderCompareGraphs(options);
    else renderCurrentModuleGraph(options);
  }

  function isPromise(value) {
    return Boolean(value && typeof value.then === "function");
  }

  return Object.freeze({ renderCurrentModuleGraph, commitCurrentWorkspace, commitCurrentGraph, renderGraphMount, renderLayoutProviderOptions, handleLayoutProviderChange, handleLayoutFailure, isPromise });
}

export const workspaceRenderPorts = Object.freeze({
  state: [
    "activeFocusedRootNodeId", "autoGraph", "cellConfig", "compare", "coneDepth", "coneRootNodeId",
    "currentModule", "design", "document", "faninDepth", "fanoutDepth", "focusedRootNodeIds", "focusedRootRefs",
    "fullGraph", "graph", "graphOverrides", "layoutFallbackFromProviderId", "layoutPolicy",
    "layoutProviderId", "nodePositions", "nodeSizes", "occurrenceContext", "presentationPolicy",
    "scene", "showAliases", "singleWorkspaceIdentity", "sourceIdentity", "timing", "timingBadgeChoices", "timingBadgePositions",
    "timingDisplayPolicy", "useFanoutHubs", "viewMode", "workspaceArtifactCache"
  ],
  elements: [
    "layoutProviderSelect", "mount"
  ],
  services: [
    "readCellLibrary",
    "applyTransform", "getCurrentLayoutProvider", "logProcess", "persistSession", "renderCompareGraphs",
    "renderDiagnostics", "renderGeneration", "renderStats", "setSingleTransform", "setStatus",
    "singleViewSession", "updateCalibrationControls", "updateViewControls", "workspaceExecution"
  ]
});
