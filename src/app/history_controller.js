import { isEditableInputTarget } from "../ui/quick_input_controller.js";
import {
  replaceCurrentViewHistory,
  createViewHistoryEntry,
  stepViewHistory,
  canStepViewHistory,
  pushViewHistory
} from "./viewHistory.js";
import { normalizeSingleViewMode } from "./singleViewMode.js";
import { setFocusedRootNodeIds, createEmptyGraphOverrides } from "./appState.js";
import { createNetlistScene } from "../domains/netlist/netlist_scene.js";
import { saveSessionState, createSessionSnapshot } from "./sessionState.js";
import { createSingleWorkspaceIdentity, createCompareWorkspaceIdentity } from "./workspace_identity.js";

// Legacy workbench adapter. State and elements are restricted ports supplied
// by the composition root; peer actions are explicit, late-bound services.
export function createHistoryController({ state, elements, services }) {
  let sessionSaveTimer = null;
  let nextViewTransactionId = 1;
  let nextRestoreId = 1;
  let activeRestoreId = 0;
  let sessionSaveFailureReported = false;
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
    state.viewHistory = replaceCurrentViewHistory(state.viewHistory, createViewHistoryEntry(state));
    const result = stepViewHistory(state.viewHistory, delta);
    if (!result.entry) {
      updateViewHistoryControls();
      return;
    }
    state.viewHistory = result.history;
    restoreViewHistoryEntry(result.entry);
  }

  function restoreViewHistoryEntry(entry) {
    const restoreId = nextRestoreId++;
    activeRestoreId = restoreId;
    state.restoringViewHistory = true;
    const endRestore = () => {
      if (activeRestoreId !== restoreId) return;
      activeRestoreId = 0;
      state.restoringViewHistory = false;
      updateViewHistoryControls();
    };
    if (entry.kind === "compare" && entry.compare) {
      try { restoreCompareViewHistoryEntry(entry, endRestore, () => activeRestoreId === restoreId); }
      catch (error) { endRestore(); throw error; }
      return;
    }
    if (state.compare.active) services.exitCompareView({ deferSingleRender: true });
    const previousPresentationPolicy = JSON.stringify(state.presentationPolicy || {});
    const finish = (graph) => {
      state.occurrenceContext = entry.occurrenceContext ? {
        rootModuleName: entry.occurrenceContext.rootModuleName || null,
        occurrencePath: [...(entry.occurrenceContext.occurrencePath || [])]
      } : null;
      services.updateModuleHierarchyPicker();
      state.viewMode = normalizeSingleViewMode(entry.viewMode);
      setFocusedRootNodeIds(state, entry.focusedRootNodeIds, entry.activeFocusedRootNodeId);
      state.focusedRootRefs = cloneObjectRefs(entry.focusedRootRefs);
      state.coneDepth = entry.coneDepth;
      state.faninDepth = entry.faninDepth;
      state.fanoutDepth = entry.fanoutDepth;
      elements.coneDepthInput.value = String(state.coneDepth);
      elements.faninDepthInput.value = String(state.faninDepth);
      elements.fanoutDepthInput.value = String(state.fanoutDepth);
      state.selectedNodeId = entry.selectedNodeId || null;
      state.selectedNet = entry.selectedNet || null;
      state.presentationPolicy = entry.presentationPolicy
        ? { ...entry.presentationPolicy }
        : state.presentationPolicy;
      state.nodePositions = new Map(entry.overrides?.nodePositions || []);
      state.nodeSizes = new Map(entry.overrides?.nodeSizes || []);
      state.graphOverrides = entry.overrides?.graphOverrides || createEmptyGraphOverrides();
      services.setSingleTransform(entry.transform);
      const canReuseWorkspace = Boolean(
        !state.compare.singleWorkspaceInvalidated && state.graph &&
        state.singleWorkspaceIdentity === createSingleWorkspaceHistoryIdentity()
      );
      const finishRestore = () => {
        if (activeRestoreId !== restoreId) return;
        const nextGraph = state.graph || graph;
        if (entry.selectedNet && nextGraph?.edges.some((edge) => edge.net === entry.selectedNet)) services.setSelectedNet(entry.selectedNet);
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
        }).catch(endRestore);
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
    try {
      if (entry.moduleName && state.currentModule.name !== entry.moduleName) {
        // Apply the history entry before rendering the destination module. Rendering
        // its saved workspace first can briefly commit an empty/stale Focused graph
        // and doubles the most expensive part of Back/Forward navigation.
        services.selectModule(entry.moduleName, { historyMode: "restore", deferRender: true });
      }
      finish(state.graph);
    } catch (error) { endRestore(); throw error; }
  }

  function createSingleWorkspaceHistoryIdentity() {
    return createSingleWorkspaceIdentity(state);
  }

  function restoreCompareViewHistoryEntry(entry, endRestore, isCurrentRestore = () => true) {
    const compare = entry.compare;
    const previousPresentationPolicy = JSON.stringify(state.presentationPolicy || {});
    const pairChanged = state.compare.leftModuleName !== compare.leftModuleName
      || state.compare.rightModuleName !== compare.rightModuleName;
    if (!state.compare.active || pairChanged) {
      elements.leftModuleSelect.value = compare.leftModuleName || "";
      elements.rightModuleSelect.value = compare.rightModuleName || "";
      services.applyCompareSelection({ historyMode: "restore", deferRender: true });
    }

    state.compare.active = true;
    state.presentationPolicy = entry.presentationPolicy
      ? { ...entry.presentationPolicy }
      : state.presentationPolicy;
    state.compare.leftModuleName = compare.leftModuleName;
    state.compare.rightModuleName = compare.rightModuleName;
    state.compare.layout = compare.layout || "vertical";
    state.compare.outputName = compare.outputName || null;
    state.compare.wholeRequested = compare.wholeRequested === true;
    state.coneDepth = entry.coneDepth;
    state.faninDepth = entry.faninDepth;
    state.fanoutDepth = entry.fanoutDepth;
    elements.coneDepthInput.value = String(state.coneDepth);
    elements.faninDepthInput.value = String(state.faninDepth);
    elements.fanoutDepthInput.value = String(state.fanoutDepth);
    state.compare.focusedRootsSynchronized = compare.focusedRootsSynchronized !== false;
    state.compare.focusedRootNodeIds = {
      left: [...(compare.focusedRootNodeIds?.left || [])],
      right: [...(compare.focusedRootNodeIds?.right || [])]
    };
    state.compare.focusedRootRefs = {
      left: cloneObjectRefs(compare.focusedRootRefs?.left),
      right: cloneObjectRefs(compare.focusedRootRefs?.right)
    };
    state.compare.activeFocusedRootNodeId = {
      left: compare.activeFocusedRootNodeId?.left || state.compare.focusedRootNodeIds.left[0] || null,
      right: compare.activeFocusedRootNodeId?.right || state.compare.focusedRootNodeIds.right[0] || null
    };
    state.compare.transforms = {
      left: { ...compare.transforms.left },
      right: { ...compare.transforms.right }
    };
    state.compare.selectedName = compare.selectedName || null;
    state.compare.selectedKind = compare.selectedKind || null;
    state.compare.selectedSide = compare.selectedSide || null;
    state.compare.nodePositions = {
      left: new Map(compare.overrides.left.nodePositions || []),
      right: new Map(compare.overrides.right.nodePositions || [])
    };
    state.compare.nodeSizes = {
      left: new Map(compare.overrides.left.nodeSizes || []),
      right: new Map(compare.overrides.right.nodeSizes || [])
    };
    state.compare.graphOverrides = {
      left: cloneGraphOverridesForHistory(compare.overrides.left.graphOverrides),
      right: cloneGraphOverridesForHistory(compare.overrides.right.graphOverrides)
    };
    elements.compareLayoutSelect.value = state.compare.layout;
    elements.syncCompareFocusInput.checked = state.compare.focusedRootsSynchronized;
    elements.comparePanel.hidden = false;
    elements.compareMount.hidden = false;
    elements.mount.hidden = true;
    services.applyCompareLayout();
    services.updateModuleHierarchyPicker();
    services.updateViewControls();
    const canReuseWorkspace = Boolean(
      state.compare.graphs?.left && state.compare.graphs?.right &&
      state.compare.workspaceIdentity === createCompareWorkspaceHistoryIdentity()
    );
    const finishRestore = () => {
      if (!isCurrentRestore()) return;
      if (state.compare.selectedName && state.compare.selectedKind && state.compare.selectedSide) {
        services.selectCompareObject(
          state.compare.selectedKind,
          state.compare.selectedName,
          false,
          state.compare.selectedSide
        );
      }
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
      }).catch(endRestore);
      return;
    }
    services.renderCompareGraphs({
      onCommitted: finishRestore,
      onCancelled: endRestore,
      onFailed: endRestore
    });
  }

  function createCompareWorkspaceHistoryIdentity() {
    return createCompareWorkspaceIdentity(state);
  }

  function cloneGraphOverridesForHistory(value = {}) {
    return {
      nodeProperties: Object.fromEntries(Object.entries(value.nodeProperties || {}).map(([id, item]) => [id, { ...item }])),
      cellPinDirections: Object.fromEntries(Object.entries(value.cellPinDirections || {}).map(([id, item]) => [id, { ...item }]))
    };
  }

  function cloneObjectRefs(value) {
    return (Array.isArray(value) ? value : []).map((ref) => ({
      ...ref,
      ...(Array.isArray(ref?.occurrencePath) ? { occurrencePath: [...ref.occurrencePath] } : {})
    }));
  }

  function updateViewHistoryControls() {
    const canViewBack = canStepViewHistory(state.viewHistory, -1);
    const canViewForward = canStepViewHistory(state.viewHistory, 1);
    elements.moduleBackButton.disabled = !canViewBack;
    elements.moduleForwardButton.disabled = !canViewForward;
  }

  function persistSession(metadata = {}) {
    if (!state.currentSource) return;
    recordViewHistory(metadata);
    clearTimeout(sessionSaveTimer);
    sessionSaveTimer = setTimeout(() => {
      const saved = saveSessionState(createSessionSnapshot(state));
      if (saved) { sessionSaveFailureReported = false; return; }
      if (sessionSaveFailureReported) return;
      sessionSaveFailureReported = true;
      services.logProcess("error", "persistence", "Session could not be saved; browser storage may be unavailable or full");
      services.setStatus("Session save failed; changes may not survive a refresh");
    }, 150);
  }

  function recordViewHistory(metadata = {}) {
    const pendingCommand = state.pendingViewCommandMetadata;
    state.pendingViewCommandMetadata = null;
    const mergedMetadata = pendingCommand
      ? {
        ...pendingCommand,
        ...metadata,
        affectedSessionIds: metadata.affectedSessionIds || pendingCommand.affectedSessionIds
      }
      : metadata;
    if (!state.currentSource || !state.currentModule || state.restoringViewHistory) return;
    if (services.viewHistoryTransactions.capture(mergedMetadata)) return;
    const affectedSessionIds = mergedMetadata.affectedSessionIds || (state.compare.active
      ? ["compare:left", "compare:right"]
      : ["single:primary"]);
    state.viewHistory = pushViewHistory(state.viewHistory, createViewHistoryEntry(state, {
      transactionId: mergedMetadata.transactionId || `view:${nextViewTransactionId++}`,
      label: mergedMetadata.label || "View change",
      affectedSessionIds
    }));
    updateViewHistoryControls();
  }

  function noteViewCommandDispatch(command, result) {
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
      "viewport.set": "Change viewport",
      "layout.policy.set": "Change layout policy",
      "presentation.policy.set": "Change presentation",
      "overrides.set": "Change layout override",
      "unit.set": "Navigate module"
    }[type] || "View command";
  }

  function runViewHistoryTransaction(metadata, operation) {
    return services.viewHistoryTransactions.run(metadata, operation);
  }

  return Object.freeze({ handleModuleHistoryShortcut, handleViewHistoryShortcut, navigateViewHistory, restoreViewHistoryEntry, createSingleWorkspaceHistoryIdentity, restoreCompareViewHistoryEntry, createCompareWorkspaceHistoryIdentity, cloneGraphOverridesForHistory, cloneObjectRefs, updateViewHistoryControls, persistSession, recordViewHistory, noteViewCommandDispatch, viewCommandLabel, runViewHistoryTransaction });
}

export const historyPorts = Object.freeze({
  state: [
    "activeFocusedRootNodeId", "activeSearchResult", "autoGraph", "cellConfig", "compare",
    "compareWorkspaces", "coneDepth", "coneRootNodeId", "currentModule", "currentSource",
    "currentSourceLabel", "document", "expandedGroupIds", "faninDepth", "fanoutDepth",
    "focusedRootNodeIds", "focusedRootRefs", "fullGraph", "graph", "graphOverrides",
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
    "syncCompareFocusInput"
  ],
  services: [
    "applyCompareHighlights", "applyCompareLayout", "applyCompareSelection", "applyCompareTransforms",
    "applyTransform", "exitCompareView", "getCompareModule", "renderCompareGraphs",
    "renderCompareOutputOptions", "renderCurrentModuleGraph", "renderDiagnostics", "renderGraphMount",
    "renderStats", "selectCompareObject", "selectModule", "setSelectedNet", "setSelectedNode", "setStatus", "logProcess",
    "setSingleTransform", "updateModuleHierarchyPicker", "updateViewControls",
    "viewHistoryTransactions"
  ]
});
