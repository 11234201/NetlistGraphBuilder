import { preparePathCandidate, renderSearchFirstPlaceholder } from "./path_candidate_render.js";
import { createSingleWorkspaceInput } from "./workspace_inputs.js";
import { buildModuleWorkspace } from "./moduleWorkspace.js";
import { cancelSchematicRender, renderSvgSceneIntoMount } from "../render/progressiveSvgRenderer.js";
import { listLayoutProviders, getLayoutProvider } from "../layout/layoutProvider.js";
import { escapeAttr, escapeHtml } from "../ui/html.js";
import { getNextLayoutProviderId } from "../layout/providerDefaults.js";
import { createSingleWorkspaceIdentity } from "./workspace_identity.js";
import { createTimingMatchReporter } from "./timing_match_log.js";
import { cancelCanvasGestures } from "../ui/canvas_gesture_lifecycle.js";

// Legacy workbench adapter. State and elements are restricted ports supplied
// by the composition root; peer actions are explicit, late-bound services.
export function createWorkspaceRenderController({ state, elements, services, mounted }) {
  const reportTiming = createTimingMatchReporter();
  function renderCurrentModuleGraph(options = {}) {
    if (options.signal?.aborted) { options.onCancelled?.(); return; }
    cancelCanvasGestures(elements.mount);
    options = services.bindViewHistoryCallbacks(options);
    const request = services.renderGeneration.begin();
    const onCancelled = options.onCancelled;
    let cancellationReported = false;
    options = { ...options, onCancelled: () => {
      if (options.signal && cancellationReported) return;
      cancellationReported = true;
      if (!options.commitPath && options.signal?.aborted && request.isCurrent() && !state.compare.active) {
        cancelSchematicRender(elements.mount);
        elements.mount.replaceChildren();
        state.autoGraph = state.graph = state.scene = null;
        state.singleWorkspaceIdentity = null;
        services.renderStats();
        services.updateCalibrationControls();
        services.updateViewControls();
      }
      onCancelled?.();
    } };
    if (!options.commitPath) state.singleWorkspaceIdentity = null;
    const requestId = request.id;
    const layoutProvider = services.getCurrentLayoutProvider();
    services.logProcess("debug", "graph", `Building ${state.currentModule?.displayName || "module"} graph`, {
      viewMode: state.viewMode,
      provider: layoutProvider.id
    });
    const workspaceOptions = createSingleWorkspaceInput(state, layoutProvider,
      services.singleViewSession.readQuery(), services.readCellLibrary?.());
    workspaceOptions.showPath = Object.hasOwn(options, "pathCandidate") ? options.pathCandidate : state.showPath;
    const workspaceIdentity = createSingleWorkspaceIdentity(state, services.readCellLibrary?.());
    const isCurrentSingleRequest = () => request.isCurrent() && !state.compare.active && !options.signal?.aborted;
    services.workspaceExecution.execute({
      provider: layoutProvider,
      signal: options.signal,
      preparePresentation: options.commitPath && (([result]) => preparePathCandidate([{ target: elements.mount, workspace: result.artifact.value }],
        () => isCurrentSingleRequest() && options.pathCurrent())),
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
      onCommit: ([result], presentation) => {
        if (!isCurrentSingleRequest()) return;
        const value = result.artifact.value;
        options.commitPath?.();
        commitCurrentWorkspace(value, { ...options, alreadyMounted: Boolean(presentation), workspaceIdentity });
      },
      onSettled: (results) => {
        if (results.some((result) => result.status !== "committed") || !isCurrentSingleRequest()) {
          options.onCancelled?.();
        }
      },
      onError: (error) => {
        if (isCurrentSingleRequest() && options.commitPath) options.onFailed(error);
        else if (isCurrentSingleRequest()) handleLayoutFailure(error, { ...options, requestId });
        else options.onCancelled?.();
      }
    });
  }

  function commitCurrentWorkspace(workspace, options = {}) {
    state.compare.singleWorkspaceInvalidated = false;
    state.fullGraph = workspace.fullGraph;
    services.singleViewSession.refreshNavigation();
    state.scene = workspace.scene;
    services.logProcess("info", "layout", `Layout completed: ${workspace.graph.nodes.length} node(s), ${workspace.graph.edges.length} edge(s)`, {
      fullNodes: workspace.fullGraph.nodes.length,
      viewMode: workspace.graph.view?.mode || state.viewMode
    });
    commitCurrentGraph(workspace.autoGraph, workspace.graph, { ...options, scene: workspace.scene,
      workspaceIdentity: createSingleWorkspaceIdentity(state, services.readCellLibrary?.()) });
  }

  function commitCurrentGraph(autoGraph, graph, options = {}) {
    const { readyMessage = null, onRendered = null, scene = null } = options;
    state.autoGraph = autoGraph;
    state.graph = graph;
    services.renderStats();
    services.renderDiagnostics();
    const renderRequest = services.renderGeneration.current();
    renderGraphMount(elements.mount, graph, { scene, alreadyMounted: options.alreadyMounted, signal: options.signal }).then((result) => {
      if (result?.cancelled || options.signal?.aborted || !renderRequest.isCurrent() || state.compare.active) {
        options.onCancelled?.(); return;
      }
      state.singleWorkspaceIdentity = options.workspaceIdentity || null;
      reportTiming(services.logProcess, state.fullGraph, state.timing, { document: state.document, requestId: renderRequest.id });
      services.applyTransform();
      services.setStatus(readyMessage || `Ready (${services.getCurrentLayoutProvider().label})`);
      services.updateCalibrationControls();
      onRendered?.(graph);
    }).catch((error) => {
      if (options.signal?.aborted || !renderRequest.isCurrent() || state.compare.active) {
        options.onCancelled?.();
        return;
      }
      services.logProcess("error", "render", `Render failed: ${error.message}`, {
        error, view: "single", moduleName: state.currentModule?.name, requestId: renderRequest.id
      });
      services.setStatus(`Render failed: ${error.message}`);
      options.onFailed?.(error);
    });
    services.updateCalibrationControls();
    services.updateViewControls();
    services.persistSession();
  }

  function renderGraphMount(mount, graph, renderOptions = {}) {
    const request = services.renderGeneration.current();
    const isCurrent = () => request.isCurrent() && !renderOptions.signal?.aborted;
    if (!isCurrent()) return Promise.resolve({ cancelled: true });
    cancelCanvasGestures(mount);
    if (renderOptions.alreadyMounted) {
      mounted?.(mount);
      return Promise.resolve({ cancelled: false });
    }
    if (graph?.view?.mode === "search-first") {
      cancelSchematicRender(mount);
      renderSearchFirstPlaceholder(mount, graph);
      return Promise.resolve().then(() => { if (isCurrent()) mounted?.(mount); return { cancelled: !isCurrent() }; });
    }
    if (!renderOptions.scene) {
      return Promise.reject(new Error("Graph mount requires a prepared scene"));
    }
    const rendering = renderSvgSceneIntoMount(mount, renderOptions.scene, {
      ...renderOptions,
      isCurrent,
      onProgress: (progress) => {
        if (!isCurrent()) return;
        const { phase, rendered, total } = progress;
        if (phase === "render") {
          services.setStatus(`Rendering ${rendered}/${total}…`);
          services.logProcess("debug", "render", `Rendering ${rendered}/${total}`, { rendered, total }, { progressKey: "svg-batch" });
        }
        renderOptions.onProgress?.(progress);
      }
    }).then((result) => {
      if (!isCurrent()) return { ...result, cancelled: true };
      if (!result?.cancelled) mounted?.(mount);
      return result;
    });
    if (!renderOptions.signal) return rendering;
    let onAbort;
    const cancelled = new Promise((resolve) => {
      onAbort = () => {
        if (request.isCurrent()) cancelSchematicRender(mount);
        resolve({ cancelled: true });
      };
      renderOptions.signal.addEventListener("abort", onAbort, { once: true });
      if (renderOptions.signal.aborted) onAbort();
    });
    // Background tabs can pause animation frames; cancellation must not wait
    // for the next batch to settle the import and clear its partial canvas.
    return Promise.race([rendering, cancelled]).finally(() => renderOptions.signal.removeEventListener("abort", onAbort));
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
    if (typeof error?.code === "string" && error.code.startsWith("show-path.")) {
      const message = `Show Path query failed: ${error.message}`;
      services.logProcess(error.code === "show-path.budget" ? "warning" : "error", "graph", message, {
        error, ...error.pathContext, operation: "show-path.query", code: error.code,
        moduleName: state.currentModule?.name, view: state.compare.active ? "compare" : "single", requestId: options.requestId });
      services.setStatus(message);
      options.onFailed?.(error);
      return;
    }
    const failedProvider = getLayoutProvider(state.layoutProviderId);
    const nextProviderId = getNextLayoutProviderId(state.layoutProviderId);
    const details = { error, operation: "layout.provider", code: "layout.provider-failed",
      provider: failedProvider.id, fallbackProvider: nextProviderId,
      view: state.compare.active ? "compare" : "single", moduleName: state.currentModule?.name,
      requestId: options.requestId };
    if (!nextProviderId) {
      services.logProcess("error", "layout", `${failedProvider.label} failed; no fallback remains: ${error.message}`, details);
      services.setStatus(`Layout failed: ${error.message}`);
      options.onFailed?.(error);
      return;
    }
    const nextProvider = getLayoutProvider(nextProviderId);
    services.logProcess("error", "layout", `${failedProvider.label} failed; falling back to ${nextProvider.label}: ${error.message}`, details);
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
    "scene", "showPath", "showAliases", "singleWorkspaceIdentity", "sourceIdentity", "timing", "timingBadgeChoices", "timingBadgePositions",
    "timingDisplayPolicy", "useFanoutHubs", "viewMode", "workspaceArtifactCache"
  ],
  elements: [
    "layoutProviderSelect", "mount"
  ],
  services: [
    "readCellLibrary",
    "bindViewHistoryCallbacks", "applyTransform", "getCurrentLayoutProvider", "logProcess", "persistSession", "renderCompareGraphs",
    "renderDiagnostics", "renderGeneration", "renderStats", "setSingleTransform", "setStatus",
    "singleViewSession", "updateCalibrationControls", "updateViewControls", "workspaceExecution"
  ]
});
