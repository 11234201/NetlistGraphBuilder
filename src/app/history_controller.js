import { hasLoadedDesignSource } from "./appState.js";
import { createViewHistoryTransaction } from "./viewHistoryTransaction.js";
import { isEditableInputTarget } from "../ui/quick_input_controller.js";
import {
  replaceCurrentViewHistory,
  createViewHistoryEntry,
  stepViewHistory,
  canStepViewHistory,
  pushViewHistory
} from "./viewHistory.js";
import { normalizeSingleViewMode } from "./singleViewMode.js";
import { resolveCompareWorkspaceInputs } from "./compareWorkspace.js";
import { normalizeCompareSyncSettings } from "./compare_sync_settings.js";
import { createNetlistScene } from "../domains/netlist/netlist_scene.js";
import { createSingleWorkspaceIdentity, createCompareWorkspaceIdentity } from "./workspace_identity.js";
import { errorMessage, readErrorField } from "../foundation/log_details.js";

// Legacy workbench adapter. State and elements are restricted ports supplied
// by the composition root; peer actions are explicit, late-bound services.
export function createHistoryController({ state, elements, services, refreshCompareSelection = services.applyCompareHighlights }) {
  let nextViewTransactionId = 1;
  let nextRestoreId = 1;
  let activeRestoreId = 0;
  let unchangedContinuation = null;
  const transactions = createViewHistoryTransaction({
    before() {
      unchangedContinuation = null;
      checkpointViewHistory();
      state.pendingViewCommandMetadata = null;
    },
    commit: (metadata) => commitViewHistory(metadata)
  });

  function checkpointViewHistory() {
    if (state.restoringViewHistory || !state.currentModule) return;
    const current = state.viewHistory.entries[state.viewHistory.index];
    if (current) state.viewHistory = replaceCurrentViewHistory(state.viewHistory, createViewHistoryEntry(state, current));
  }

  function logRestoreFailure(error, view, code, moduleName = state.currentModule?.name) {
    if (readErrorField(error, "name") === "AbortError") return;
    const message = `${view === "compare" ? "Compare history" : "History"} restore failed: ${errorMessage(error)}`;
    try {
      services.logProcess("error", "navigation", message, {
        error, view, operation: "history.restore", code, moduleName,
        fileCount: state.sourceFiles?.length, documentId: state.document?.documentId
      });
    } catch { /* Diagnostics must preserve the restore failure. */ }
  }
  function reportHistoryRenderFailure(error, view, isCurrent, endRestore) {
    if (isCurrent()) logRestoreFailure(error, view, "history.render-failed");
    endRestore();
  }
  function handleModuleHistoryShortcut(event) {
    if (!event.altKey || event.ctrlKey || event.metaKey || isEditableInputTarget(event.target)) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    // Alt+Arrow, toolbar navigation, and Ctrl+Z all share one operation timeline.
    navigateViewHistory(event.key === "ArrowLeft" ? -1 : 1);
  }

  function handleViewHistoryShortcut(event) {
    if (isEditableInputTarget(event.target)) return;
    const undo = (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "z" && !event.shiftKey;
    const redo = (event.ctrlKey || event.metaKey) && (
      (event.key.toLowerCase() === "z" && event.shiftKey) || event.key.toLowerCase() === "y"
    );
    if (!undo && !redo) return;
    event.preventDefault();
    navigateViewHistory(undo ? -1 : 1);
  }

  function navigateViewHistory(delta) {
    if (!state.currentModule) return;
    checkpointViewHistory();
    const result = stepViewHistory(state.viewHistory, delta);
    if (!result.entry) {
      updateViewHistoryControls();
      return;
    }
    restoreViewHistoryEntry(result.entry, result.history);
  }

  function restoreViewHistoryEntry(entry, nextHistory) {
    const view = entry.kind === "compare" && entry.compare ? "compare" : "single";
    const modules = state.document?.model?.modules;
    if (modules) {
      const requested = view === "compare" ? [entry.compare.leftModuleName, entry.compare.rightModuleName] : [entry.moduleName];
      for (const name of requested) {
        if (modules.some(module => module.name === name)) continue;
        const error = new Error(`History module is unavailable: ${name || "(unspecified)"}`);
        logRestoreFailure(error, view, "history.module-unavailable", name);
        services.setStatus(error.message);
        return;
      }
    }
    const previousHistory = state.viewHistory;
    if (nextHistory) state.viewHistory = nextHistory;
    unchangedContinuation = null;
    transactions.invalidate();
    const restoreId = nextRestoreId++;
    activeRestoreId = restoreId;
    state.restoringViewHistory = true;
    const endRestore = () => {
      if (activeRestoreId !== restoreId) return;
      activeRestoreId = 0;
      state.restoringViewHistory = false;
      updateViewHistoryControls();
      services.persistSession();
    };
    const isCurrent = () => activeRestoreId === restoreId;
    try {
      if (view === "compare") restoreCompareViewHistoryEntry(entry, endRestore, isCurrent);
      else restoreSingleViewHistoryEntry(entry, endRestore, isCurrent);
    } catch (error) {
      if (isCurrent()) {
        logRestoreFailure(error, view, "history.restore-failed", entry.moduleName);
        if (nextHistory) state.viewHistory = previousHistory;
        activeRestoreId = 0;
        state.restoringViewHistory = false;
        updateViewHistoryControls();
      }
      throw error;
    }
  }

  function restoreSingleViewHistoryEntry(entry, endRestore, isCurrent) {
    if (state.compare.active) services.exitCompareView({ deferSingleRender: true });
    const previousPresentationPolicy = JSON.stringify(state.presentationPolicy || {});
    const previousWorkspaceIdentity = createSingleWorkspaceHistoryIdentity();
    const finish = (graph) => {
      state.occurrenceContext = entry.occurrenceContext ? {
        rootModuleName: entry.occurrenceContext.rootModuleName || null,
        occurrencePath: [...(entry.occurrenceContext.occurrencePath || [])]
      } : null;
      services.updateModuleHierarchyPicker();
      services.singleViewSession.importNavigation({ ...entry, viewMode: normalizeSingleViewMode(entry.viewMode) });
      elements.coneDepthInput.value = String(state.coneDepth);
      elements.faninDepthInput.value = String(state.faninDepth);
      elements.fanoutDepthInput.value = String(state.fanoutDepth);
      services.singleViewSession.importState({
        ...(entry.presentationPolicy ? { presentationPolicy: entry.presentationPolicy } : {}),
        overrides: entry.overrides || null, viewport: entry.transform
      });
      const canReuseWorkspace = Boolean(
        !state.compare.singleWorkspaceInvalidated && state.graph &&
        state.singleWorkspaceIdentity === previousWorkspaceIdentity &&
        state.singleWorkspaceIdentity === createSingleWorkspaceHistoryIdentity()
      );
      const finishRestore = () => {
        if (!isCurrent()) return;
        const nextGraph = state.graph || graph;
        if (entry.selectedNet && (nextGraph?.edges.some((edge) => edge.net === entry.selectedNet) || nextGraph?.unroutedNets?.includes(entry.selectedNet))) services.setSelectedNet(entry.selectedNet);
        else if (entry.selectedNodeId && nextGraph?.nodes.some((node) => node.id === entry.selectedNodeId)) services.setSelectedNode(entry.selectedNodeId);
        else services.setSelectedNode(null);
        services.applyTransform();
        endRestore();
      };
      if (canReuseWorkspace && previousPresentationPolicy === JSON.stringify(state.presentationPolicy || {})) {
        finishRestore();
        return;
      }
      if (canReuseWorkspace) {
        state.scene = createNetlistScene(state.graph, { presentationPolicy: state.presentationPolicy });
        services.renderGraphMount(elements.mount, state.graph, { scene: state.scene }).then((result) => {
          if (result?.cancelled) { endRestore(); return; }
          finishRestore();
        }).catch((error) => reportHistoryRenderFailure(error, "single", isCurrent, endRestore));
        return;
      }
      services.renderCurrentModuleGraph({
        onRendered: (nextGraph) => {
          graph = nextGraph;
          finishRestore();
        },
        onCancelled: endRestore,
        onFailed: endRestore
      });
    };
    if (entry.moduleName && state.currentModule.name !== entry.moduleName) {
      // Restore the destination before rendering to avoid committing its stale Focused graph.
      services.selectModule(entry.moduleName, { historyMode: "restore", deferRender: true });
    }
    finish(state.graph);
  }

  function createSingleWorkspaceHistoryIdentity() {
    return createSingleWorkspaceIdentity(state, services.readCellLibrary?.());
  }

  function restoreCompareViewHistoryEntry(entry, endRestore, isCurrentRestore = () => true) {
    const compare = entry.compare;
    const previousWorkspaceIdentity = createCompareWorkspaceHistoryIdentity();
    const previousPresentationPolicy = JSON.stringify(state.presentationPolicy || {});
    const pairChanged = state.compare.leftModuleName !== compare.leftModuleName
      || state.compare.rightModuleName !== compare.rightModuleName;
    if (!state.compare.active || pairChanged) {
      elements.leftModuleSelect.value = compare.leftModuleName || "";
      elements.rightModuleSelect.value = compare.rightModuleName || "";
      services.applyCompareSelection({ historyMode: "restore", deferRender: true });
    }

    state.compare.active = true;
    if (entry.presentationPolicy) services.singleViewSession.importState({ presentationPolicy: entry.presentationPolicy });
    state.compare.leftModuleName = compare.leftModuleName;
    state.compare.rightModuleName = compare.rightModuleName;
    state.compare.layout = compare.layout || "horizontal";
    state.compare.outputName = compare.outputName || null;
    state.compare.wholeRequested = compare.wholeRequested === true;
    services.singleViewSession.importQuery({ coneDepth: entry.coneDepth, faninDepth: entry.faninDepth, fanoutDepth: entry.fanoutDepth });
    elements.coneDepthInput.value = String(state.coneDepth);
    elements.faninDepthInput.value = String(state.faninDepth);
    elements.fanoutDepthInput.value = String(state.fanoutDepth);
    Object.assign(state.compare, normalizeCompareSyncSettings(compare));
    services.compareViewSessions.importNavigation(compare);
    const query = services.singleViewSession.readQuery();
    services.compareViewSessions.importQuery(query, resolveCompareWorkspaceInputs({
      ...query, leftModule: services.getCompareModule("left"), rightModule: services.getCompareModule("right"),
      fullGraphs: state.compare.fullGraphs, outputName: state.compare.outputName,
      focusedRootNodeIds: state.compare.focusedRootNodeIds, forceWhole: state.compare.wholeRequested
    }));
    elements.compareLayoutSelect.value = state.compare.layout;
    elements.syncCompareInput.checked = state.compare.synchronized;
    elements.syncCompareSelectionInput.checked = state.compare.selectionSynchronized;
    elements.syncCompareFocusInput.checked = state.compare.focusedRootsSynchronized;
    elements.comparePanel.hidden = false;
    elements.compareMount.hidden = false;
    elements.mount.hidden = true;
    services.applyCompareLayout();
    services.updateModuleHierarchyPicker();
    services.updateViewControls();
    const canReuseWorkspace = Boolean(
      state.compare.graphs?.left && state.compare.graphs?.right &&
      state.compare.workspaceIdentity === previousWorkspaceIdentity &&
      state.compare.workspaceIdentity === createCompareWorkspaceHistoryIdentity()
    );
    const finishRestore = () => {
      if (!isCurrentRestore()) return;
      refreshCompareSelection();
      services.applyCompareTransforms();
      endRestore();
    };
    if (canReuseWorkspace && previousPresentationPolicy === JSON.stringify(state.presentationPolicy || {})) {
      services.renderCompareOutputOptions(services.getCompareModule("left"), services.getCompareModule("right"));
      services.renderStats();
      services.renderDiagnostics();
      finishRestore();
      return;
    }
    if (canReuseWorkspace) {
      for (const side of ["left", "right"]) {
        state.compare.scenes[side] = createNetlistScene(state.compare.graphs[side], {
          presentationPolicy: state.presentationPolicy
        });
      }
      Promise.all([
        services.renderGraphMount(elements.leftMount, state.compare.graphs.left, { scene: state.compare.scenes.left }),
        services.renderGraphMount(elements.rightMount, state.compare.graphs.right, { scene: state.compare.scenes.right })
      ]).then((results) => {
        if (results.some((result) => result?.cancelled)) { endRestore(); return; }
        services.applyCompareHighlights();
        services.renderStats();
        services.renderDiagnostics();
        finishRestore();
      }).catch((error) => reportHistoryRenderFailure(error, "compare", isCurrentRestore, endRestore));
      return;
    }
    services.renderCompareGraphs({
      onCommitted: finishRestore,
      onCancelled: endRestore,
      onFailed: endRestore
    });
  }

  function createCompareWorkspaceHistoryIdentity() {
    return createCompareWorkspaceIdentity(state, services.readCellLibrary?.());
  }

  function updateViewHistoryControls() {
    const canViewBack = canStepViewHistory(state.viewHistory, -1);
    const canViewForward = canStepViewHistory(state.viewHistory, 1);
    elements.moduleBackButton.disabled = !canViewBack;
    elements.moduleForwardButton.disabled = !canViewForward;
  }

  function commitViewHistory(metadata = {}) {
    recordViewHistory(metadata);
    services.persistSession();
  }

  function bindViewHistoryCallbacks(options = {}, successKey = "onRendered") {
    return { ...options, [successKey]: transactions.bind(options[successKey] || (() => {}), () => options.onCancelled?.()) };
  }

  function recordViewHistory(metadata = {}) {
    const currentTransactionId = state.viewHistory.entries[state.viewHistory.index]?.transactionId;
    const firstAsyncChange = metadata.continuation && unchangedContinuation?.transactionId === metadata.transactionId
      && unchangedContinuation.baseTransactionId === currentTransactionId;
    if (metadata.continuation && currentTransactionId !== metadata.transactionId && !firstAsyncChange) return;
    const pendingCommand = state.pendingViewCommandMetadata;
    state.pendingViewCommandMetadata = null;
    const mergedMetadata = pendingCommand
      ? {
        ...pendingCommand,
        ...metadata,
        affectedSessionIds: metadata.affectedSessionIds || pendingCommand.affectedSessionIds
      }
      : metadata;
    if (!hasLoadedDesignSource(state) || !state.currentModule || state.restoringViewHistory) return;
    if (transactions.capture(mergedMetadata)) return;
    if (!mergedMetadata.transactionId) transactions.invalidate();
    const affectedSessionIds = mergedMetadata.affectedSessionIds || (state.compare.active
      ? ["compare:left", "compare:right"]
      : ["single:primary"]);
    const entry = createViewHistoryEntry(state, {
      transactionId: mergedMetadata.transactionId || `view:${nextViewTransactionId++}`,
      label: mergedMetadata.label || "View change",
      affectedSessionIds
    });
    // A synchronous no-op owns no entry yet. Its first asynchronous change must
    // append (so Undo retains the baseline); subsequent completions replace it.
    state.viewHistory = mergedMetadata.continuation && !firstAsyncChange
      ? replaceCurrentViewHistory(state.viewHistory, entry)
      : pushViewHistory(state.viewHistory, entry);
    const committedId = state.viewHistory.entries[state.viewHistory.index]?.transactionId;
    unchangedContinuation = mergedMetadata.transactionId && committedId !== mergedMetadata.transactionId
      ? { transactionId: mergedMetadata.transactionId, baseTransactionId: committedId } : null;
    updateViewHistoryControls();
  }

  function noteViewCommandDispatch(command, result) {
    if (command?.recordHistory === false) return;
    if (!result || result.rejected || !Object.values(result.effects || {}).some(Boolean)) return;
    const sessionId = command?.sessionId;
    const previous = state.pendingViewCommandMetadata;
    const affectedSessionIds = [...new Set([
      ...(previous?.affectedSessionIds || []),
      ...(sessionId ? [sessionId] : [])
    ])];
    state.pendingViewCommandMetadata = {
      label: previous?.label || viewCommandLabel(command.type),
      affectedSessionIds
    };
  }

  function viewCommandLabel(type) {
    return {
      "selection.set": "Select object",
      "selection.clear": "Clear selection",
      "selection.reveal": "Reveal search target",
      "focus.add": "Add Focused root",
      "focus.set": "Set Focused root",
      "focus.replace": "Replace Focused roots",
      "focus.remove": "Remove Focused root",
      "focus.clear": "Clear Focused roots",
      "focus.activate": "Activate Focused root",
      "view.mode.set": "Change view mode",
      "view.depths.set": "Change Focused depth",
      "view.coneDepth.set": "Change output depth",
      "viewport.set": "Change viewport",
      "layout.policy.set": "Change layout policy",
      "presentation.policy.set": "Change presentation",
      "overrides.set": "Change layout override",
      "unit.set": "Navigate module"
    }[type] || "View command";
  }

  function runViewHistoryTransaction(metadata, operation) {
    if (state.restoringViewHistory) return operation();
    return transactions.run(metadata, operation);
  }

  return Object.freeze({ handleModuleHistoryShortcut, handleViewHistoryShortcut, navigateViewHistory, restoreViewHistoryEntry, createSingleWorkspaceHistoryIdentity, restoreCompareViewHistoryEntry, createCompareWorkspaceHistoryIdentity, updateViewHistoryControls, commitViewHistory, bindViewHistoryCallbacks, recordViewHistory, noteViewCommandDispatch, viewCommandLabel, runViewHistoryTransaction });
}

export const historyPorts = Object.freeze({
  state: [
    "activeFocusedRootNodeId", "activeSearchResult", "autoGraph", "cellConfig", "compare",
    "compareWorkspaces", "coneDepth", "coneRootNodeId", "currentModule", "currentSource",
    "currentSourceLabel", "sourceFiles", "document", "expandedGroupIds", "faninDepth", "fanoutDepth",
    "focusedRootNodeIds", "focusedRootRefs", "fullGraph", "graph", "showPath", "graphOverrides",
    "layoutFallbackFromProviderId", "layoutPolicy", "layoutProviderId", "moduleWorkspaces",
    "nodePositions", "nodeSizes", "occurrenceContext", "pendingViewCommandMetadata",
    "presentationPolicy", "restoringViewHistory", "scene", "searchQuery", "searchResults",
    "selectedNet", "selectedNodeId", "showAliases", "singleWorkspaceIdentity", "sourceIdentity", "timing", "timingBadgeChoices",
    "timingBadgePositions", "timingDisplayPolicy", "transform", "useFanoutHubs", "viewHistory",
    "viewMode", "workspaceArtifactCache"
  ],
  elements: [
    "compareLayoutSelect", "compareMount", "comparePanel", "coneDepthInput", "faninDepthInput",
    "fanoutDepthInput", "leftModuleSelect", "leftMount",
    "moduleBackButton", "moduleForwardButton", "mount", "rightModuleSelect", "rightMount",
    "syncCompareInput", "syncCompareSelectionInput", "syncCompareFocusInput"
  ],
  services: [
    "readCellLibrary",
    "applyCompareHighlights", "applyCompareLayout", "applyCompareSelection", "applyCompareTransforms",
    "applyTransform", "exitCompareView", "getCompareModule", "renderCompareGraphs",
    "renderCompareOutputOptions", "renderCurrentModuleGraph", "renderDiagnostics", "renderGraphMount",
    "renderStats", "selectModule", "setSelectedNet", "setSelectedNode", "setStatus", "logProcess",
    "setSingleTransform", "updateModuleHierarchyPicker", "updateViewControls",
    "persistSession", "singleViewSession", "compareViewSessions"
  ]
});
