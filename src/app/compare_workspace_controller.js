import { recommendModulePair, compareModules } from "../analysis/moduleCompare.js";
import { saveCompareWorkspace, restoreCompareWorkspace } from "./appState.js";
import { createCompareWorkspaceIdentity } from "./workspace_identity.js";
import { prepareCompareWorkspace, buildCompareSideWorkspace } from "./compareWorkspace.js";
import { escapeAttr, escapeHtml } from "../ui/html.js";

// Legacy workbench adapter. State and elements are restricted ports supplied
// by the composition root; peer actions are explicit, late-bound services.
export function createCompareWorkspaceController({ state, elements, services }) {
  function renderCompareModuleOptions() {
    for (const select of [elements.leftModuleSelect, elements.rightModuleSelect]) {
      select.innerHTML = "";
      for (const module of state.design.modules) {
        const option = document.createElement("option");
        option.value = module.name;
        option.textContent = module.displayName;
        select.append(option);
      }
    }
  }

  function handleCompareOutputChange(event) {
    state.compare.outputName = event.target.value || null;
    state.compare.wholeRequested = !state.compare.outputName;
    if (state.compare.outputName) {
      for (const side of ["left", "right"]) services.compareViewSessions.dispatch(side, { type: "focus.clear" });
    }
    elements.coneDepthInput.disabled = !state.compare.outputName;
    renderCompareGraphs();
    services.renderStats();
    services.recordViewHistory();
  }

  function enterCompareView() {
    const left = state.currentModule || state.design?.modules[0];
    const right = recommendModulePair(state.design?.modules || [], left?.name)
      || state.design?.modules.find((module) => module !== left);
    if (!left || !right) {
      services.setStatus("Compare requires at least two modules");
      return;
    }
    elements.leftModuleSelect.value = left.name;
    elements.rightModuleSelect.value = right.name;
    applyCompareSelection();
  }

  function applyCompareSelection(options = {}) {
    if (options.historyMode === "restore") return applyCompareSelectionImpl(options);
    return services.runViewHistoryTransaction({ label: "Compare selection" }, () => applyCompareSelectionImpl(options));
  }

  function applyCompareSelectionImpl(options = {}) {
    const left = state.design.modules.find((module) => module.name === elements.leftModuleSelect.value);
    const right = state.design.modules.find((module) => module.name === elements.rightModuleSelect.value);
    if (!left || !right || left === right) {
      services.setStatus("Choose two different modules to compare");
      return;
    }
    services.workspaceJobs.cancelSession("single:primary");
    // Compare also supersedes a progressive Single DOM render after its job has
    // already committed, so returning to Single must restore a complete mount.
    state.compare.singleWorkspaceInvalidated = true;
    const pairChanged = state.compare.leftModuleName !== left.name || state.compare.rightModuleName !== right.name;
    if (state.compare.leftModuleName && state.compare.rightModuleName) {
      saveCompareWorkspace(state);
    }
    state.compare.active = true;
    const restoredWorkspace = pairChanged
      ? restoreCompareWorkspace(state, left.name, right.name)
      : true;
    state.compare.leftModuleName = left.name;
    state.compare.rightModuleName = right.name;
    if (!restoredWorkspace) {
      state.compare.outputName = null;
      state.compare.wholeRequested = false;
    }
    services.clearCompareSelection();
    services.updateFocusSelectedControl();
    services.setCompareTransform("left", restoredWorkspace
      ? state.compare.transforms.left
      : { x: 0, y: 0, scale: 1 }, false);
    services.setCompareTransform("right", restoredWorkspace
      ? state.compare.transforms.right
      : { x: 0, y: 0, scale: 1 }, false);
    elements.comparePanel.hidden = false;
    services.updateModuleHierarchyPicker();
    elements.mount.hidden = true;
    elements.compareMount.hidden = false;
    elements.compareButton.classList.add("is-active");
    elements.compareButton.textContent = "Single";
    elements.compareButton.title = "退出双 module 对比视图";
    elements.compareButton.setAttribute("aria-pressed", "true");
    elements.compareLayoutSelect.value = state.compare.layout;
    elements.syncCompareFocusInput.checked = state.compare.focusedRootsSynchronized !== false;
    applyCompareLayout();
    elements.coneDepthInput.disabled = !state.compare.outputName;
    if (!options.deferRender) renderCompareGraphs();
    services.renderStats();
    services.renderSelection(null);
    services.updateCalibrationControls();
    services.updateViewHistoryControls();
    services.setStatus(`Comparing ${left.displayName} and ${right.displayName}`);
    if (options.historyMode !== "restore") services.recordViewHistory();
  }

  function exitCompareView(options = {}) {
    state.compare.layoutAbortController?.abort();
    state.compare.layoutAbortController = null;
    services.workspaceJobs.cancelSession("compare:left");
    services.workspaceJobs.cancelSession("compare:right");
    services.renderGeneration.begin();
    saveCompareWorkspace(state);
    state.compare.active = false;
    const rebuildSingleWorkspace = state.compare.singleWorkspaceInvalidated === true && !options.deferSingleRender;
    services.updateFocusSelectedControl();
    elements.comparePanel.hidden = true;
    services.updateModuleHierarchyPicker();
    elements.compareMount.hidden = true;
    elements.mount.hidden = false;
    elements.compareButton.classList.remove("is-active");
    elements.compareButton.textContent = "Compare";
    elements.compareButton.title = "进入双 module 对比视图";
    elements.compareButton.setAttribute("aria-pressed", "false");
    services.updateViewControls();
    services.renderStats();
    services.updateCalibrationControls();
    services.updateViewHistoryControls();
    services.applyTransform();
    if (rebuildSingleWorkspace) services.renderCurrentModuleGraph();
    else services.setStatus(`Single module view: ${state.currentModule?.displayName || "-"}`);
    services.recordViewHistory();
  }

  function applyCompareLayout() {
    elements.compareMount.classList.toggle("is-horizontal", state.compare.layout === "horizontal");
    elements.compareMount.classList.toggle("is-vertical", state.compare.layout !== "horizontal");
  }

  function renderCompareGraphs(options = {}) {
    const leftModule = getCompareModule("left");
    const rightModule = getCompareModule("right");
    if (!leftModule || !rightModule) return;
    state.compare.layoutAbortController?.abort();
    const layoutController = new AbortController();
    state.compare.layoutAbortController = layoutController;
    services.recordViewHistory();
    const request = services.renderGeneration.begin();
    const requestId = request.id;
    const compareLayoutProvider = services.getCurrentLayoutProvider();
    services.logProcess("debug", "graph", `Building Compare workspace: ${leftModule.displayName} / ${rightModule.displayName}`, {
      provider: compareLayoutProvider.id
    });
    const workspaceOptions = {
      leftModule,
      rightModule,
      layoutProvider: compareLayoutProvider,
      layoutPolicy: state.layoutPolicy,
      outputName: state.compare.outputName,
      coneDepth: state.coneDepth,
      faninDepth: state.faninDepth,
      fanoutDepth: state.fanoutDepth,
      focusedRootNodeIds: state.compare.focusedRootNodeIds,
      activeFocusedRootNodeId: state.compare.activeFocusedRootNodeId,
      showAliases: state.showAliases,
      presentationPolicy: state.presentationPolicy,
      timing: state.timing,
      timingDisplayPolicy: state.timingDisplayPolicy,
      timingBadgeChoices: state.compare.timingBadgeChoices,
      timingBadgePositions: state.compare.timingBadgePositions,
      graphOverrides: state.compare.graphOverrides,
      cellConfig: state.cellConfig,
      cellLibrary: services.readCellLibrary?.(),
      nodePositions: state.compare.nodePositions,
      nodeSizes: state.compare.nodeSizes,
      useFanoutHubs: state.useFanoutHubs,
      moduleLibrary: state.design.modules,
      forceWhole: state.compare.wholeRequested,
      artifactCache: state.workspaceArtifactCache,
      artifactIdentity: {
        documentId: state.document?.documentId || null,
        sourceRevision: state.document?.sourceRevision || 0,
        sourceIdentity: state.sourceIdentity || null,
        sessionId: "compare"
      },
      signal: layoutController.signal,
      onSideStatus: (side, status) => {
        if (state.compare.layoutAbortController !== layoutController) return;
        updateCompareSideStatus(side, side === "left" ? leftModule : rightModule, status);
      }
    };
    const workspaceIdentity = createCompareWorkspaceIdentity(state, services.readCellLibrary?.());
    const renderOptions = { ...options, layoutController, workspaceIdentity };
    try {
      // Full graphs and comparison inputs are a light, shared preparation step;
      // layout/override/Scene work then runs under one JobCoordinator boundary
      // per compare side so a stale side cannot commit through its peer.
      const prepared = prepareCompareWorkspace(workspaceOptions);
      state.compare.fullGraphs = prepared.fullGraphs;
      const sides = ["left", "right"];
      const buildSide = (side, contextSignal) => buildCompareSideWorkspace({
        ...workspaceOptions,
        side,
        module: side === "left" ? leftModule : rightModule,
        fullGraph: prepared.fullGraphs[side],
        workspaceInput: prepared.workspaceInputs[side],
        signal: layoutController.signal,
        sideSignal: contextSignal
      });
      const commitResults = (results) => {
        if (results.some((result) => result.status !== "committed")) return;
        const [leftResult, rightResult] = results;
        commitCompareWorkspace({
          fullGraphs: prepared.fullGraphs,
          autoGraphs: { left: leftResult.artifact.value.autoGraph, right: rightResult.artifact.value.autoGraph },
          graphs: { left: leftResult.artifact.value.graph, right: rightResult.artifact.value.graph },
          scenes: { left: leftResult.artifact.value.scene, right: rightResult.artifact.value.scene },
          analysis: compareModules(leftModule, rightModule, prepared.fullGraphs.left, prepared.fullGraphs.right)
        }, leftModule, rightModule, renderOptions);
      };
      services.workspaceExecution.execute({
        provider: compareLayoutProvider,
        tasks: sides.map((side) => ({
          beginComputation: () => services.compareViewSessions.beginComputation(side),
          kind: `compare-${side}-workspace`,
          run: (context) => buildSide(side, context.signal)
        })),
        onStarted(jobs) {
          jobs.forEach((job, index) => services.logProcess("info", "layout", `Compare ${sides[index]} layout started (${compareLayoutProvider.label})`, {
            requestId, side: sides[index], jobId: job.context.jobId
          }));
          services.setStatus(`Compare layout (${compareLayoutProvider.label})…`);
        },
        onCommit: commitResults,
        onSettled: (results) => {
          if (results.some((result) => result.status !== "committed")) renderOptions.onCancelled?.();
        },
        onError: (error) => services.handleLayoutFailure(error, renderOptions)
      });
    } catch (error) {
      services.handleLayoutFailure(error, renderOptions);
    }
  }

  function commitCompareWorkspace(workspace, leftModule, rightModule, options = {}) {
    if (options.layoutController && (
      state.compare.layoutAbortController !== options.layoutController || options.layoutController.signal.aborted
    )) return;
    if (state.compare.layoutAbortController === options.layoutController) state.compare.layoutAbortController = null;
    state.compare.fullGraphs = workspace.fullGraphs;
    state.compare.autoGraphs = workspace.autoGraphs;
    state.compare.graphs = workspace.graphs;
    state.compare.scenes = workspace.scenes;
    state.compare.analysis = workspace.analysis;
    state.compare.workspaceIdentity = null;
    const renderRequest = services.renderGeneration?.current?.() || { isCurrent: () => true };
    services.renderDiagnostics();
    services.logProcess("info", "layout", `Compare layout completed: ${workspace.graphs.left.nodes.length} / ${workspace.graphs.right.nodes.length} node(s)`, {
      leftModule: leftModule.name,
      rightModule: rightModule.name
    });
    elements.compareMount.querySelector('[data-compare-side="left"] > header').textContent = leftModule.displayName;
    elements.compareMount.querySelector('[data-compare-side="right"] > header').textContent = rightModule.displayName;
    renderCompareOutputOptions(leftModule, rightModule);
    Promise.all([
      services.renderGraphMount(elements.leftMount, state.compare.graphs.left, { scene: state.compare.scenes.left }),
      services.renderGraphMount(elements.rightMount, state.compare.graphs.right, { scene: state.compare.scenes.right })
    ]).then((results) => {
      if (!renderRequest.isCurrent() || (options.workspaceIdentity && !state.compare.active)) {
        options.onCancelled?.(); return;
      }
      if (results.some((result) => result?.cancelled)) { options.onCancelled?.(); return; }
      state.compare.workspaceIdentity = options.workspaceIdentity || null;
      services.applyCompareHighlights();
      services.applyCompareTransforms();
      services.logProcess("info", "render", "Compare render completed", {
        leftNodes: state.compare.graphs.left.nodes.length,
        rightNodes: state.compare.graphs.right.nodes.length
      });
      services.setStatus(`Compare ready (${services.getCurrentLayoutProvider().label})`);
      options.onCommitted?.();
    }).catch((error) => {
      if (!renderRequest.isCurrent() || (options.workspaceIdentity && !state.compare.active)) {
        options.onCancelled?.(); return;
      }
      services.logProcess("error", "render", `Compare render failed: ${error.message}`);
      services.setStatus(`Compare render failed: ${error.message}`);
      options.onFailed?.(error);
    });
  }

  function updateCompareSideStatus(side, module, status) {
    const header = elements.compareMount.querySelector(`[data-compare-side="${side}"] > header`);
    if (!header) return;
    const label = module?.displayName || module?.name || side;
    header.textContent = status === "loading"
      ? `${label} · Loading…`
      : status === "failed" ? `${label} · Failed`
        : status === "cancelled" ? `${label} · Cancelled` : label;
  }

  function renderCompareOutputOptions(left, right) {
    const selected = state.compare.outputName || "";
    const rightOutputs = new Set(right.ports.filter((port) => port.direction === "output").map((port) => port.name));
    const outputs = left.ports.filter((port) => port.direction === "output" && rightOutputs.has(port.name));
    elements.compareOutputSelect.innerHTML = `<option value="">Whole module</option>${outputs.map((port) =>
      `<option value="${escapeAttr(port.name)}">${escapeHtml(port.displayName)}</option>`).join("")}`;
    elements.compareOutputSelect.value = selected;
  }

  function getCompareModule(side) {
    return state.design?.modules.find((module) => module.name === state.compare[`${side}ModuleName`]);
  }

  return Object.freeze({ renderCompareModuleOptions, handleCompareOutputChange, enterCompareView, applyCompareSelection, applyCompareSelectionImpl, exitCompareView, applyCompareLayout, renderCompareGraphs, commitCompareWorkspace, updateCompareSideStatus, renderCompareOutputOptions, getCompareModule });
}

export const compareWorkspacePorts = Object.freeze({
  state: [
    "activeFocusedRootNodeId", "activeSearchResult", "autoGraph", "cellConfig", "compare",
    "compareWorkspaces", "coneDepth", "coneRootNodeId", "currentModule", "design", "document",
    "expandedGroupIds", "faninDepth", "fanoutDepth", "focusedRootNodeIds", "focusedRootRefs",
    "fullGraph", "graph", "graphOverrides", "layoutPolicy", "moduleWorkspaces", "nodePositions",
    "nodeSizes", "occurrenceContext", "presentationPolicy", "restoringViewHistory", "scene",
    "searchResults", "selectedNet", "selectedNodeId", "showAliases", "sourceIdentity", "timing",
    "timingBadgeChoices", "timingBadgePositions", "timingDisplayPolicy", "useFanoutHubs", "viewHistory",
    "viewMode", "workspaceArtifactCache"
  ],
  elements: [
    "compareButton", "compareLayoutSelect", "compareMount", "compareOutputSelect", "comparePanel",
    "coneDepthInput", "leftModuleSelect", "leftMount", "mount", "rightModuleSelect", "rightMount",
    "syncCompareFocusInput"
  ],
  services: [
    "readCellLibrary",
    "applyCompareHighlights", "applyCompareTransforms", "applyTransform", "clearCompareSelection",
    "compareViewSessions", "getCurrentLayoutProvider", "handleLayoutFailure", "logProcess",
    "recordViewHistory", "renderCurrentModuleGraph", "renderDiagnostics", "renderGeneration",
    "renderGraphMount", "renderSelection", "renderStats", "runViewHistoryTransaction", "setCompareTransform", "setStatus",
    "updateCalibrationControls", "updateFocusSelectedControl", "updateModuleHierarchyPicker",
    "updateViewControls", "updateViewHistoryControls", "workspaceExecution", "workspaceJobs"
  ]
});
