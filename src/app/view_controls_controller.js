import { normalizeSingleViewMode } from "./singleViewMode.js";
import { normalizeFocusedRootNodeIds } from "./appState.js";
import { findCompareNode } from "./compareWorkspace.js";
import { resolveFocusedRootTarget, focusedNetRootId } from "./focusedSelection.js";

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
      services.replaceSingleFocusedRoots(rootNodeIds);
    }
    const modeResult = services.setSingleViewMode(mode);
    if (modeResult?.rejected) return;
    services.renderCurrentModuleGraph();
    services.setSingleTransform({ x: 0, y: 0, scale: 1 });
    if (mode === "focused" && !state.selectedNodeId && state.coneRootNodeId) {
      services.setSelectedNode(state.coneRootNodeId);
    }
    services.applyTransform();
    const message = mode === "whole"
      ? "Whole module overview"
      : mode === "focused"
        ? `Focused neighborhood: fanin ${state.faninDepth}, fanout ${state.fanoutDepth}`
        : "Search-first mode";
    services.setStatus(message);
  }

  function setCompareViewMode(mode) {
    return services.runViewHistoryTransaction({ label: `Compare view mode: ${mode}` }, () => setCompareViewModeImpl(mode));
  }

  function setCompareViewModeImpl(mode) {
    const context = services.getFocusedRootContext();
    if (mode === "focused") {
      if (context.roots.length === 0) {
        const selected = state.compare.selectedKind === "net" && state.compare.selectedName
          ? { id: focusedNetRootId(state.compare.selectedName) }
          : findCompareNode(context.fullGraph, "cell", state.compare.selectedName);
        if (!selected) {
          services.setStatus("Select a compare cell before opening Focused view");
          return;
        }
        services.setCompareFocusedRootNodeIds(context.side, [selected.id], selected.id);
      }
      services.setCompareTransform(context.side, { x: 0, y: 0, scale: 1 });
      updateViewControls();
      services.renderCompareGraphs();
      services.setStatus(`Compare ${context.side} Focused: fanin ${state.faninDepth}, fanout ${state.fanoutDepth}`);
      return;
    }
    if (mode === "whole") {
      for (const side of ["left", "right"]) {
        services.setCompareFocusedRootNodeIds(side, []);
        services.setCompareTransform(side, { x: 0, y: 0, scale: 1 }, false);
      }
      state.compare.outputName = null;
      state.compare.wholeRequested = true;
      updateViewControls();
      services.renderCompareGraphs();
      services.setStatus("Whole compare modules");
    }
  }

  function handleConeDepthChange(event) {
    state.coneDepth = services.clamp(Math.floor(Number(event.target.value) || 1), 1, 99);
    elements.coneDepthInput.value = String(state.coneDepth);
    if (state.compare.active && state.compare.outputName) {
      services.renderCompareGraphs();
      services.renderStats();
      services.setStatus(`Compare fanin cone depth ${state.coneDepth}`);
      return;
    }
    if (state.viewMode !== "whole") {
      setViewMode(state.viewMode);
    }
  }

  function handleFocusedDepthChange() {
    const result = services.setSingleFocusedDepths(
      services.clamp(Math.floor(Number(elements.faninDepthInput.value) || 0), 0, 99),
      services.clamp(Math.floor(Number(elements.fanoutDepthInput.value) || 0), 0, 99)
    );
    elements.faninDepthInput.value = String(state.faninDepth);
    elements.fanoutDepthInput.value = String(state.fanoutDepth);
    if (state.compare.active) {
      if (state.compare.focusedRootNodeIds.left.length > 0 || state.compare.focusedRootNodeIds.right.length > 0) {
        services.renderCompareGraphs();
        services.renderStats();
      }
    } else if (state.viewMode === "focused" && result?.effects?.layout) {
      services.setSingleTransform({ x: 0, y: 0, scale: 1 });
      services.renderCurrentModuleGraph();
    }
    else services.persistSession();
  }

  function scheduleFocusedDepthChange() {
    clearTimeout(focusedDepthChangeTimer);
    focusedDepthChangeTimer = setTimeout(handleFocusedDepthChange, 120);
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
    "applyTransform", "clamp", "getFocusedRootContext", "getSelectedSingleCell", "persistSession",
    "renderCompareGraphs", "renderCurrentModuleGraph", "renderFocusedRootList", "renderStats",
    "replaceSingleFocusedRoots", "runViewHistoryTransaction", "setCompareFocusedRootNodeIds",
    "setCompareTransform", "setSelectedNode", "setSingleFocusedDepths", "setSingleTransform",
    "setSingleViewMode", "setStatus", "singleViewSession", "updateFocusSelectedControl",
    "updateViewHistoryControls"
  ]
});
