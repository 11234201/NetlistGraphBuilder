import { normalizeSingleViewMode } from "./singleViewMode.js";
import { normalizeFocusedRootNodeIds } from "./appState.js";
import { findCompareNode } from "./compareWorkspace.js";
import { resolveFocusedRootTarget, focusedNetRootId } from "./focusedSelection.js";
import { executeViewEffects, mergeViewEffects } from "../application/view_effects.js";

// Legacy workbench adapter. State and elements are restricted ports supplied
// by the composition root; peer actions are explicit, late-bound services.
export function createViewControlsController({ state, elements, services }) {
  let focusedDepthChangeTimer = null;
  function setViewMode(mode) {
    return services.runViewHistoryTransaction({ label: `View mode: ${mode}` }, () => setViewModeImpl(mode));
  }

  function setViewModeImpl(mode) {
    mode = normalizeSingleViewMode(mode);
    if (state.compare.active) {
      setCompareViewMode(mode);
      return;
    }
    let rootsResult;
    if (mode !== "whole" && mode !== "search-first") {
      const existingRootNodeIds = normalizeFocusedRootNodeIds(
        state.focusedRootNodeIds,
        state.coneRootNodeId
      );
      const rootNodeIds = existingRootNodeIds.length > 0
        ? existingRootNodeIds
        : state.selectedNodeId ? [state.selectedNodeId]
          : state.selectedNet ? [focusedNetRootId(state.selectedNet)] : [];
      if (rootNodeIds.length === 0) {
        services.setStatus("Select a cell before opening Focused view");
        return;
      }
      rootsResult = services.replaceSingleFocusedRoots(rootNodeIds);
      if (rootsResult?.rejected) return;
    }
    const modeResult = services.setSingleViewMode(mode);
    if (modeResult?.rejected) return;
    const message = mode === "whole"
      ? "Whole module overview"
      : mode === "focused"
        ? `Focused neighborhood: fanin ${state.faninDepth}, fanout ${state.fanoutDepth}`
        : "Search-first mode";
    services.setStatus(message);
    return executeViewEffects({ ...modeResult, effects: mergeViewEffects(rootsResult?.effects, modeResult?.effects) }, {
      requireReady: true, isReady: () => services.singleViewSession.isWorkspaceReady(),
      beforeCompute: () => services.setSingleTransform({ x: 0, y: 0, scale: 1 }),
      compute: (options) => services.renderCurrentModuleGraph(options),
      onCommitted: () => {
        if (mode === "focused" && !state.selectedNodeId && state.coneRootNodeId) services.setSelectedNode(state.coneRootNodeId);
        services.applyTransform();
      }
    });
  }

  function setCompareViewMode(mode) {
    return services.runViewHistoryTransaction({ label: `Compare view mode: ${mode}` }, () => setCompareViewModeImpl(mode));
  }

  function setCompareViewModeImpl(mode) {
    const context = services.getFocusedRootContext(state.compare.activeSide);
    if (mode === "focused") {
      let result;
      if (context.roots.length === 0) {
        const ref = services.compareViewSessions.readState(context.side).selectedObjectRef;
        const selected = ref?.kind === "net" ? {id:focusedNetRootId(ref.localId)}
          : ref?.kind === "cell" ? findCompareNode(context.fullGraph,"cell",ref.localId) : null;
        if (!selected) {
          services.setStatus("Select a compare cell before opening Focused view");
          return;
        }
        result = services.setCompareFocusedRootNodeIds(context.side, [selected.id], selected.id);
      }
      services.setStatus(`Compare ${context.side} Focused: fanin ${state.faninDepth}, fanout ${state.fanoutDepth}`);
      return executeViewEffects(result, {
        requireReady: true, isReady: () => services.compareViewSessions.isWorkspaceReady(),
        beforeCompute: () => services.setCompareTransform(context.side, { x: 0, y: 0, scale: 1 }),
        compute: ({ onRendered, ...callbacks }) => services.renderCompareGraphs({ ...callbacks, onCommitted: onRendered }),
        render: updateViewControls
      });
    }
    if (mode === "whole") {
      const changedQuery = !state.compare.wholeRequested || Boolean(state.compare.outputName);
      const results = [];
      for (const side of ["left", "right"]) {
        results.push(services.setCompareFocusedRootNodeIds(side, []));
      }
      state.compare.outputName = null;
      state.compare.wholeRequested = true;
      const effects = mergeViewEffects(...results.map((result) => result?.effects),
        changedQuery ? { query: true, layout: true, render: true, persist: true } : null);
      services.setStatus("Whole compare modules");
      return executeViewEffects({ effects }, {
        requireReady: true, isReady: () => services.compareViewSessions.isWorkspaceReady(),
        beforeCompute: () => { for (const side of ["left", "right"]) services.setCompareTransform(side, { x: 0, y: 0, scale: 1 }, false); },
        compute: ({ onRendered, ...callbacks }) => services.renderCompareGraphs({ ...callbacks, onCommitted: onRendered }),
        render: updateViewControls
      });
    }
  }

  function handleConeDepthChange(event) {
    const result = services.singleViewSession.dispatch({ type: "view.coneDepth.set", coneDepth: Number(event.target.value) || 1 });
    elements.coneDepthInput.value = String(state.coneDepth);
    const shouldCompute = Boolean(state.compare.active && state.compare.outputName && result.effects?.layout);
    if (shouldCompute) services.setStatus(`Compare fanin cone depth ${state.coneDepth}`);
    return executeViewEffects(result, {
      shouldCompute,
      requireReady: Boolean(state.compare.active && state.compare.outputName),
      isReady: () => services.compareViewSessions.isWorkspaceReady(),
      compute: ({ onRendered, ...callbacks }) => services.renderCompareGraphs({ ...callbacks, onCommitted: onRendered }),
      onCommitted: () => {
        if (shouldCompute) services.renderStats();
      },
      persist: () => services.persistSession()
    });
  }

  function handleFocusedDepthChange() {
    const result = services.setSingleFocusedDepths(
      services.clamp(Math.floor(Number(elements.faninDepthInput.value) || 0), 0, 99),
      services.clamp(Math.floor(Number(elements.fanoutDepthInput.value) || 0), 0, 99)
    );
    elements.faninDepthInput.value = String(state.faninDepth);
    elements.fanoutDepthInput.value = String(state.fanoutDepth);
    const focused = state.compare.active
      ? state.compare.focusedRootNodeIds.left.length > 0 || state.compare.focusedRootNodeIds.right.length > 0
      : state.viewMode === "focused";
    return executeViewEffects(result, {
      shouldCompute: Boolean(focused && result?.effects?.layout),
      requireReady: focused,
      isReady: () => state.compare.active ? services.compareViewSessions.isWorkspaceReady() : services.singleViewSession.isWorkspaceReady(),
      beforeCompute: () => { if (!state.compare.active) services.setSingleTransform({ x: 0, y: 0, scale: 1 }); },
      compute: (options) => {
        if (!state.compare.active) services.renderCurrentModuleGraph(options);
        else { const { onRendered, ...callbacks } = options; services.renderCompareGraphs({ ...callbacks, onCommitted: onRendered }); }
      },
      onCommitted: () => { if (state.compare.active && focused) services.renderStats(); },
      persist: () => services.persistSession()
    });
  }

  function scheduleFocusedDepthChange() {
    clearTimeout(focusedDepthChangeTimer);
    focusedDepthChangeTimer = setTimeout(() => services.runViewHistoryTransaction(
      { label: "Change Focused depth" }, handleFocusedDepthChange), 120);
  }

  function handleAliasVisibilityChange(event) {
    const selectedNode = state.graph?.nodes.find((node) => node.id === state.selectedNodeId);
    state.showAliases = event.target.checked;
    if (state.compare.active) {
      services.renderCompareGraphs();
      services.renderStats();
      services.setStatus(state.showAliases ? "Compare aliases shown" : "Compare aliases collapsed");
      return;
    }
    const selectedNodeId = state.selectedNodeId;
    if (!state.showAliases && selectedNode?.kind === "assign") {
      services.singleViewSession.dispatch({ type: "focus.clear" });
    }
    services.renderCurrentModuleGraph();
    services.setSelectedNode(state.graph.nodes.some((node) => node.id === selectedNodeId) ? selectedNodeId : null);
    services.applyTransform();
    services.setStatus(state.showAliases ? "Alias nodes shown" : `Collapsed ${state.fullGraph.aliases?.length || 0} alias node(s)`);
  }

  function updateViewControls() {
    const focusedContext = services.getFocusedRootContext();
    const selectedCompareCell = state.compare.active && state.compare.selectedKind === "cell";
    const selectedCompareNet = state.compare.active && state.compare.selectedKind === "net";
    const hasRoot = state.compare.active
      ? focusedContext.roots.length > 0 || selectedCompareCell || selectedCompareNet
      : Boolean(state.selectedNodeId || state.selectedNet || state.focusedRootNodeIds.length || state.coneRootNodeId);
    const isFocused = state.compare.active
      ? focusedContext.roots.length > 0
      : state.viewMode === "focused";
    elements.wholeViewButton.classList.toggle("is-active", state.compare.active ? !isFocused : state.viewMode === "whole");
    elements.focusedViewButton.classList.toggle("is-active", isFocused);
    elements.focusedViewButton.disabled = !hasRoot;
    elements.coneDepthInput.disabled = !state.compare.active || !state.compare.outputName;
    elements.faninDepthInput.disabled = state.compare.active ? !isFocused : state.viewMode !== "focused";
    elements.fanoutDepthInput.disabled = state.compare.active ? !isFocused : state.viewMode !== "focused";
    elements.showAliasesInput.checked = state.showAliases;
    elements.fanoutHubsInput.checked = state.useFanoutHubs;
    services.updateViewHistoryControls();
    updateFocusedRootControl();
    services.updateFocusSelectedControl();
    services.renderFocusedRootList();
  }

  function updateFocusedRootControl() {
    const focusedContext = services.getFocusedRootContext();
    const selectedCompareNet = state.compare.active && state.compare.selectedKind === "net";
    const target = state.compare.active
      ? (state.compare.selectedKind === "cell"
        ? findCompareNode(focusedContext.fullGraph, "cell", state.compare.selectedName)?.id || null
        : null)
      : resolveFocusedRootTarget(
        state.fullGraph,
        state.selectedNodeId,
        state.focusedRootNodeIds,
        state.viewMode
      );
    const selectedSingleNet = !state.compare.active && Boolean(state.selectedNet);
    elements.setFocusedRootButton.disabled = !(target || selectedCompareNet || selectedSingleNet);
    const selectedCell = state.compare.active
      ? Boolean(target)
      : Boolean(services.getSelectedSingleCell());
    const selectedNodeId = target || services.getSelectedSingleCell()?.id || state.selectedNodeId;
    const selectedRootId = state.compare.active
      ? (selectedCell ? selectedNodeId : selectedCompareNet ? focusedNetRootId(state.compare.selectedName) : null)
      : (selectedCell ? selectedNodeId : state.selectedNet ? focusedNetRootId(state.selectedNet) : null);
    elements.addFocusedRootButton.disabled = !selectedRootId || focusedContext.roots.includes(selectedRootId);
    elements.removeFocusedRootButton.disabled = !selectedRootId || !focusedContext.roots.includes(selectedRootId);
    elements.clearFocusedRootsButton.disabled = focusedContext.roots.length === 0;
  }

  return Object.freeze({ setViewMode, setViewModeImpl, setCompareViewMode, setCompareViewModeImpl, handleConeDepthChange, handleFocusedDepthChange, scheduleFocusedDepthChange, handleAliasVisibilityChange, updateViewControls, updateFocusedRootControl });
}

export const viewControlsPorts = Object.freeze({
  historyActions: {
    "handleConeDepthChange": "Change output depth",
    "handleFocusedDepthChange": "Change Focused depth"
  },
  state: [
    "activeFocusedRootNodeId", "activeSearchResult", "autoGraph", "compare", "compareWorkspaces",
    "coneDepth", "coneRootNodeId", "expandedGroupIds", "faninDepth", "fanoutDepth",
    "focusedRootNodeIds", "focusedRootRefs", "fullGraph", "graph", "graphOverrides", "moduleWorkspaces",
    "nodePositions", "nodeSizes", "occurrenceContext", "restoringViewHistory", "scene", "searchResults",
    "selectedNet", "selectedNodeId", "showAliases", "timing", "timingBadgeChoices",
    "timingBadgePositions", "useFanoutHubs", "viewHistory", "viewMode", "workspaceArtifactCache"
  ],
  elements: [
    "addFocusedRootButton", "clearFocusedRootsButton", "coneDepthInput", "faninDepthInput",
    "fanoutDepthInput", "fanoutHubsInput", "focusedViewButton", "removeFocusedRootButton",
    "setFocusedRootButton", "showAliasesInput", "wholeViewButton"
  ],
  services: [
    "applyTransform", "clamp", "compareViewSessions", "getFocusedRootContext", "getSelectedSingleCell", "persistSession",
    "renderCompareGraphs", "renderCurrentModuleGraph", "renderFocusedRootList", "renderStats",
    "replaceSingleFocusedRoots", "runViewHistoryTransaction", "setCompareFocusedRootNodeIds",
    "setCompareTransform", "setSelectedNode", "setSingleFocusedDepths", "setSingleTransform",
    "setSingleViewMode", "setStatus", "singleViewSession", "updateFocusSelectedControl",
    "updateViewHistoryControls"
  ]
});
