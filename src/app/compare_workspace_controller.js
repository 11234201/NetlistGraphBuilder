import { createCompareCommands } from "./remote_compare_commands.js";
import { preparePathCandidate } from "./path_candidate_render.js";
import { recommendModulePair, compareModules } from "../analysis/moduleCompare.js";
import { saveCompareWorkspace, restoreCompareWorkspace } from "./appState.js";
import { createCompareWorkspaceIdentity } from "./workspace_identity.js";
import { prepareCompareWorkspace, buildCompareSideWorkspace } from "./compareWorkspace.js";
import { escapeAttr, escapeHtml } from "../ui/html.js";
import { cancelSchematicRender } from "../render/progressiveSvgRenderer.js";
import { cancelCanvasGestures } from "../ui/canvas_gesture_lifecycle.js";
import { mergeImportedTiming } from "../domains/netlist/timing_import.js";
import { createTimingMatchReporter } from "./timing_match_log.js";

// Legacy workbench adapter. State and elements are restricted ports supplied
// by the composition root; peer actions are explicit, late-bound services.
export function createCompareWorkspaceController({ state, elements, services }) {
  const reportTiming = createTimingMatchReporter();
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
    cancelCanvasGestures(elements.mount);
    services.workspaceJobs.cancelSession("single:primary");
    // Compare also supersedes a progressive Single DOM render after its job has
    // already committed, so returning to Single must restore a complete mount.
    state.compare.singleWorkspaceInvalidated = true;
    const pairChanged = state.compare.leftModuleName !== left.name || state.compare.rightModuleName !== right.name;
    if (state.compare.leftModuleName && state.compare.rightModuleName) {
      saveCompareWorkspace(state);
    }
    state.compare.active = true;
    state.compare.leftModuleName = left.name;
    state.compare.rightModuleName = right.name;
    const restoredWorkspace = pairChanged
      ? restoreCompareWorkspace(state, left.name, right.name, (value) => services.compareViewSessions.importNavigation(value))
      : true;
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
    updateCompareSideTimingControls();
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
    cancelCanvasGestures(elements.mount);
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
    if (options.signal?.aborted) { options.onCancelled?.(); return; }
    options = services.bindViewHistoryCallbacks(options, "onCommitted");
    const leftModule = getCompareModule("left");
    const rightModule = getCompareModule("right");
    if (!leftModule || !rightModule) return;
    cancelCanvasGestures(elements.mount);
    state.compare.layoutAbortController?.abort();
    const layoutController = new AbortController();
    state.compare.layoutAbortController = layoutController;
    const request = services.renderGeneration.begin();
    const onCancelled = options.onCancelled;
    const onFailed = options.onFailed;
    function retainPrevious() {
      if (!options.commitPath || state.compare.layoutAbortController !== layoutController) return;
      layoutController.abort();
      state.compare.layoutAbortController = null;
      updateCompareSideStatus("left", leftModule, "ready");
      updateCompareSideStatus("right", rightModule, "ready");
    }
    let cancellationReported = false;
    options = { ...options, onFailed: (error) => { retainPrevious(); onFailed?.(error); }, onCancelled: () => {
      if (options.signal && cancellationReported) return;
      cancellationReported = true;
      if (!options.commitPath && options.signal?.aborted && request.isCurrent() && state.compare.active) {
        layoutController.abort();
        if (state.compare.layoutAbortController === layoutController) state.compare.layoutAbortController = null;
        for (const mount of [elements.leftMount, elements.rightMount]) {
          cancelSchematicRender(mount);
          mount.replaceChildren();
        }
        state.compare.graphs = { left: null, right: null };
        state.compare.autoGraphs = { left: null, right: null };
        state.compare.scenes = { left: null, right: null };
        state.compare.workspaceIdentity = null;
        updateCompareSideStatus("left", leftModule, "cancelled");
        updateCompareSideStatus("right", rightModule, "cancelled");
      }
      retainPrevious();
      onCancelled?.();
    } };
    const requestId = request.id;
    const compareLayoutProvider = services.getCurrentLayoutProvider();
    services.logProcess("debug", "graph", `Building Compare workspace: ${leftModule.displayName} / ${rightModule.displayName}`, {
      provider: compareLayoutProvider.id
    });
    const query = services.singleViewSession.readQuery();
    const workspaceOptions = {
      leftModule,
      rightModule,
      layoutProvider: compareLayoutProvider,
      layoutPolicy: state.layoutPolicy,
      showPath: { ...state.compare.showPath, ...options.pathCandidate },
      outputName: state.compare.outputName,
      coneDepth: query.coneDepth,
      faninDepth: query.faninDepth,
      fanoutDepth: query.fanoutDepth,
      focusedRootNodeIds: state.compare.focusedRootNodeIds,
      activeFocusedRootNodeId: state.compare.activeFocusedRootNodeId,
      showAliases: state.showAliases,
      presentationPolicy: state.presentationPolicy,
      timing: state.timing,
      sideTiming: state.compare.sideTiming,
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
      const projectInputs = () => {
        state.compare.fullGraphs = prepared.fullGraphs;
        services.compareViewSessions.importQuery(query, prepared.workspaceInputs);
        for (const side of ["left", "right"]) services.compareViewSessions.refreshNavigation(side);
      };
      if (!options.commitPath) projectInputs();
      renderOptions.workspaceIdentity = createCompareWorkspaceIdentity(state, services.readCellLibrary?.());
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
      const commitResults = (results, presentation) => {
        if (results.some((result) => result.status !== "committed")) return;
        const [leftResult, rightResult] = results;
        const value = {
          fullGraphs: prepared.fullGraphs,
          autoGraphs: { left: leftResult.artifact.value.autoGraph, right: rightResult.artifact.value.autoGraph },
          graphs: { left: leftResult.artifact.value.graph, right: rightResult.artifact.value.graph },
          scenes: { left: leftResult.artifact.value.scene, right: rightResult.artifact.value.scene },
          analysis: compareModules(leftModule, rightModule, prepared.fullGraphs.left, prepared.fullGraphs.right)
        };
        if (options.commitPath) { options.commitPath(); projectInputs(); }
        commitCompareWorkspace(value, leftModule, rightModule, { ...renderOptions, alreadyMounted: Boolean(presentation) });
      };
      services.workspaceExecution.execute({
        provider: compareLayoutProvider,
        signal: options.signal,
        preparePresentation: options.commitPath && ((results) => preparePathCandidate(
          sides.map((side, index) => ({ target: side === "left" ? elements.leftMount : elements.rightMount, workspace: results[index].artifact.value })),
          () => request.isCurrent() && state.compare.active && !layoutController.signal.aborted && !options.signal?.aborted && options.pathCurrent())),
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
        onError: (error) => options.commitPath ? options.onFailed(error) : services.handleLayoutFailure(error, renderOptions)
      });
    } catch (error) {
      if (options.commitPath) options.onFailed(error);
      else services.handleLayoutFailure(error, renderOptions);
    }
  }

  function commitCompareWorkspace(workspace, leftModule, rightModule, options = {}) {
    if (options.signal?.aborted) { options.onCancelled?.(); return; }
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
    services.renderStats();
    services.renderDiagnostics();
    services.logProcess("info", "layout", `Compare layout completed: ${workspace.graphs.left.nodes.length} / ${workspace.graphs.right.nodes.length} node(s)`, {
      leftModule: leftModule.name,
      rightModule: rightModule.name
    });
    updateCompareSideStatus("left", leftModule, "ready");
    updateCompareSideStatus("right", rightModule, "ready");
    renderCompareOutputOptions(leftModule, rightModule);
    Promise.all([
      services.renderGraphMount(elements.leftMount, state.compare.graphs.left, { scene: state.compare.scenes.left, alreadyMounted: options.alreadyMounted, signal: options.signal }),
      services.renderGraphMount(elements.rightMount, state.compare.graphs.right, { scene: state.compare.scenes.right, alreadyMounted: options.alreadyMounted, signal: options.signal })
    ]).then((results) => {
      if (options.signal?.aborted || !renderRequest.isCurrent() || (options.workspaceIdentity && !state.compare.active)) {
        options.onCancelled?.(); return;
      }
      if (results.some((result) => result?.cancelled)) { options.onCancelled?.(); return; }
      for (const side of ["left", "right"]) {
        reportTiming(services.logProcess, workspace.fullGraphs[side], state.compare.sideTiming?.[side] || state.timing,
          { document: state.document, side, requestId: renderRequest.id });
      }
      state.compare.workspaceIdentity = options.pathCandidate ? createCompareWorkspaceIdentity(state, services.readCellLibrary?.()) : options.workspaceIdentity || null;
      services.applyCompareHighlights();
      services.applyCompareTransforms();
      services.logProcess("info", "render", "Compare render completed", {
        leftNodes: state.compare.graphs.left.nodes.length,
        rightNodes: state.compare.graphs.right.nodes.length
      });
      services.setStatus(`Compare ready (${services.getCurrentLayoutProvider().label})`);
      options.onCommitted?.(workspace.graphs);
    }).catch((error) => {
      if (options.signal?.aborted || !renderRequest.isCurrent() || (options.workspaceIdentity && !state.compare.active)) {
        options.onCancelled?.(); return;
      }
      services.logProcess("error", "render", `Compare render failed: ${error.message}`, {
        error, view: "compare", leftModule: state.compare.leftModuleName, rightModule: state.compare.rightModuleName
      });
      services.setStatus(`Compare render failed: ${error.message}`);
      options.onFailed?.(error);
    });
  }

  function updateCompareSideStatus(side, module, status) {
    const header = elements.compareMount.querySelector(`[data-compare-side="${side}"] > header`);
    if (!header) return;
    const timingLabel = state.compare.sideTiming?.[side]
      ? (state.compare.sideTimingLabels?.[side] || "timing override")
      : null;
    const base = `${side === "left" ? "A" : "B"} · ${module?.displayName || module?.name || side}`;
    const label = timingLabel ? `${base} · ${timingLabel}` : base;
    const rawDetail = module?.name && module.name !== module.displayName ? `${base}\n${module.name}` : base;
    header.title = timingLabel ? `${rawDetail}\nTiming (${side === "left" ? "A" : "B"}): ${timingLabel}` : rawDetail;
    header.textContent = status === "loading"
      ? `${label} · Loading…`
      : status === "failed" ? `${label} · Failed`
        : status === "cancelled" ? `${label} · Cancelled` : label;
  }

  function updateCompareSideTimingControls() {
    for (const [side, statusEl, clearBtn] of [
      ["left", elements.compareLeftTimingStatus, elements.compareLeftClearTimingButton],
      ["right", elements.compareRightTimingStatus, elements.compareRightClearTimingButton]
    ]) {
      const sideTiming = state.compare.sideTiming?.[side];
      const label = state.compare.sideTimingLabels?.[side];
      if (statusEl) {
        statusEl.textContent = sideTiming
          ? `${label || "override"} (${sideTiming.instanceCount})`
          : state.timing ? `shared (${state.timing.instanceCount})` : "none";
      }
      if (clearBtn) clearBtn.hidden = !sideTiming;
    }
  }

  function setCompareSideTiming(side, timing, label, { append = false } = {}) {
    if (side !== "left" && side !== "right") return null;
    const prev = state.compare.sideTiming?.[side] || null;
    const next = append && prev ? mergeImportedTiming(prev, timing) : timing;
    const prevLabel = state.compare.sideTimingLabels?.[side];
    state.compare.sideTiming[side] = next;
    state.compare.sideTimingLabels[side] = append && prev && prevLabel ? `${prevLabel} + ${label}` : label;
    state.compare.timingBadgeChoices[side] = {};
    state.compare.timingBadgePositions[side] = {};
    updateCompareSideTimingControls();
    return next;
  }

  function clearCompareSideTiming(side, { render = true, onCommitted = null } = {}) {
    if (side !== "left" && side !== "right") return;
    if (!state.compare.sideTiming?.[side]) return;
    state.compare.sideTiming[side] = null;
    state.compare.sideTimingLabels[side] = null;
    state.compare.timingBadgeChoices[side] = {};
    state.compare.timingBadgePositions[side] = {};
    updateCompareSideTimingControls();
    if (render && state.compare.active) {
      renderCompareGraphs({
        onCommitted: () => {
          services.renderStats();
          services.setStatus(`Cleared ${side === "left" ? "A" : "B"} timing override`);
          onCommitted?.();
        }
      });
    }
  }

  function assignCompareSideModule(options = {}) {
    renderCompareModuleOptions();
    if (options.leftModuleName) elements.leftModuleSelect.value = options.leftModuleName;
    if (options.rightModuleName) elements.rightModuleSelect.value = options.rightModuleName;
    const left = state.design.modules.find((m) => m.name === elements.leftModuleSelect.value);
    const right = state.design.modules.find((m) => m.name === elements.rightModuleSelect.value);
    if (!left || !right || left === right) {
      services.setStatus("Choose two different modules to compare");
      options.onFailed?.(new Error("Choose two different modules to compare"));
      return;
    }
    applyCompareSelectionImpl({ historyMode: "restore", deferRender: true });
    renderCompareGraphs({
      signal: options.signal,
      onCommitted: options.onCommitted,
      onFailed: options.onFailed,
      onCancelled: options.onCancelled
    });
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

  const runCompareCommand = createCompareCommands({
    modules:() => (state.design?.modules || []).map(module => module.name), controls:() => elements,
    enter:enterCompareView, apply:applyCompareSelection, exit:exitCompareView, clearTiming:clearCompareSideTiming,
    setSide:side => services.compareViewSessions.setActiveSide(side), changeOutput:handleCompareOutputChange,
    setDepth:depth => services.singleViewSession.dispatch({type:"view.coneDepth.set",coneDepth:depth}), summary:() => state.compare.analysis,
    read:() => ({active:state.compare.active, applied:{A:state.compare.leftModuleName,B:state.compare.rightModuleName},
      draft:{A:elements.leftModuleSelect.value,B:elements.rightModuleSelect.value},side:({left:"A",right:"B"})[state.compare.activeSide] || null,
      split:state.compare.layout,syncViewport:state.compare.synchronized,syncRoots:state.compare.focusedRootsSynchronized,
      timing:{A:state.compare.sideTimingLabels.left || null,B:state.compare.sideTimingLabels.right || null},
      output:state.compare.outputName,depth:state.coneDepth})
  });
  return Object.freeze({ runCompareCommand, renderCompareModuleOptions, handleCompareOutputChange, enterCompareView, applyCompareSelection, applyCompareSelectionImpl, exitCompareView, applyCompareLayout, renderCompareGraphs, commitCompareWorkspace, updateCompareSideStatus, renderCompareOutputOptions, getCompareModule, updateCompareSideTimingControls, setCompareSideTiming, clearCompareSideTiming, assignCompareSideModule });
}

export const compareWorkspacePorts = Object.freeze({
  historyActions: {
    "handleCompareOutputChange": "Compare output",
    "exitCompareView": "Exit Compare"
  },
  state: [
    "activeFocusedRootNodeId", "activeSearchResult", "autoGraph", "cellConfig", "compare",
    "compareWorkspaces", "coneDepth", "coneRootNodeId", "currentModule", "design", "document",
    "expandedGroupIds", "faninDepth", "fanoutDepth", "focusedRootNodeIds", "focusedRootRefs",
    "fullGraph", "graph", "graphOverrides", "layoutPolicy", "moduleWorkspaces", "nodePositions",
    "nodeSizes", "occurrenceContext", "presentationPolicy", "restoringViewHistory", "scene", "showPath",
    "searchResults", "selectedNet", "selectedNodeId", "showAliases", "sourceIdentity", "timing",
    "timingBadgeChoices", "timingBadgePositions", "timingDisplayPolicy", "useFanoutHubs", "viewHistory",
    "viewMode", "workspaceArtifactCache"
  ],
  elements: [
    "compareButton", "compareLayoutSelect", "compareLeftClearTimingButton", "compareLeftTimingStatus",
    "compareMount", "compareOutputSelect", "comparePanel", "compareRightClearTimingButton",
    "compareRightTimingStatus", "coneDepthInput", "leftModuleSelect", "leftMount", "mount",
    "rightModuleSelect", "rightMount", "syncCompareFocusInput"
  ],
  services: [
    "singleViewSession",
    "readCellLibrary",
    "applyCompareHighlights", "applyCompareTransforms", "applyTransform", "clearCompareSelection",
    "compareViewSessions", "getCurrentLayoutProvider", "handleLayoutFailure", "logProcess",
    "bindViewHistoryCallbacks", "recordViewHistory", "renderCurrentModuleGraph", "renderDiagnostics", "renderGeneration",
    "renderGraphMount", "renderSelection", "renderStats", "runViewHistoryTransaction", "setCompareTransform", "setStatus",
    "updateCalibrationControls", "updateFocusSelectedControl", "updateModuleHierarchyPicker",
    "updateViewControls", "updateViewHistoryControls", "workspaceExecution", "workspaceJobs"
  ]
});
