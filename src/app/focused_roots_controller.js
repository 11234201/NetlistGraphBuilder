import {
  normalizeFocusedRootNodeIds as normalizeFocusedSelectionRoots,
  resolveFocusedRootState,
  addFocusedRootNodeId,
  resolveFocusedRootTarget,
  focusedNetRootId,
  focusedNetName,
  resolveFocusedRootAction
} from "./focusedSelection.js";
import { findCompareNode, getCompareNodeName } from "./compareWorkspace.js";
import { shouldUseSearchFirst } from "./graphWorkspace.js";
import { escapeAttr, escapeHtml } from "../ui/html.js";
import { isEditableInputTarget } from "../ui/quick_input_controller.js";
import { captureFocusedRootsFocus } from "../ui/focused_roots_focus.js";

// Legacy workbench adapter. State and elements are restricted ports supplied
// by the composition root; peer actions are explicit, late-bound services.
export function createFocusedRootsController({ state, elements, services }) {
  let focusedRootsQuery = "";

  function getSelectedSingleCell() {
    return state.fullGraph?.nodes.find(
      (node) => node.id === state.selectedNodeId && node.kind === "cell"
    ) || null;
  }

  function getFocusedRootContext() {
    if (state.compare.active) {
      const side = state.compare.selectedSide || "left";
      return {
        compare: true,
        side,
        fullGraph: state.compare.fullGraphs?.[side] || state.compare.graphs?.[side],
        graph: state.compare.graphs?.[side],
        roots: normalizeFocusedSelectionRoots(state.compare.focusedRootNodeIds?.[side]),
        activeRootNodeId: state.compare.activeFocusedRootNodeId?.[side] || null
      };
    }
    return {
      compare: false,
      side: null,
      fullGraph: state.fullGraph,
      graph: state.graph,
      roots: normalizeFocusedSelectionRoots(state.focusedRootNodeIds),
      activeRootNodeId: state.activeFocusedRootNodeId
    };
  }

  function setCompareFocusedRootNodeIds(side, value, activeRootNodeId = null) {
    if (!state.compare.focusedRootNodeIds) state.compare.focusedRootNodeIds = { left: [], right: [] };
    if (!state.compare.focusedRootNodeIds[side]) state.compare.focusedRootNodeIds[side] = [];
    if (!state.compare.activeFocusedRootNodeId) {
      state.compare.activeFocusedRootNodeId = { left: null, right: null };
    }
    const resolved = resolveFocusedRootState(value, activeRootNodeId, state.compare.activeFocusedRootNodeId[side]);
    const mirrored = services.compareViewSessions.replaceRoots(side, resolved.rootNodeIds, resolved.activeRootNodeId);
    const roots = mirrored.rootNodeIds;
    state.compare.focusedRootNodeIds[side] = roots;
    state.compare.activeFocusedRootNodeId[side] = mirrored.activeRootNodeId;
    state.compare.outputName = null;
    return roots;
  }

  function syncCompareFocusedRootNode(side, nodeId, operation) {
    if (state.compare.focusedRootsSynchronized === false) return null;
    const oppositeSide = side === "left" ? "right" : "left";
    if (operation === "clear") {
      setCompareFocusedRootNodeIds(oppositeSide, []);
      return null;
    }
    const sourceNode = state.compare.fullGraphs?.[side]?.nodes.find((node) => node.id === nodeId);
    const oppositeGraph = state.compare.fullGraphs?.[oppositeSide] || state.compare.graphs?.[oppositeSide];
    const oppositeNode = findCompareNode(oppositeGraph, "cell", getCompareNodeName(sourceNode));
    if (!oppositeNode) return null;
    const currentRoots = normalizeFocusedSelectionRoots(state.compare.focusedRootNodeIds?.[oppositeSide]);
    if (operation === "replace") {
      setCompareFocusedRootNodeIds(oppositeSide, [oppositeNode.id], oppositeNode.id);
    } else if (operation === "remove") {
      setCompareFocusedRootNodeIds(oppositeSide, currentRoots.filter((id) => id !== oppositeNode.id));
    } else if (operation === "add") {
      setCompareFocusedRootNodeIds(oppositeSide, addFocusedRootNodeId(currentRoots, oppositeNode.id), oppositeNode.id);
    }
    return oppositeNode;
  }

  function setSelectedAsFocusedRoot() {
    if (state.compare.active) {
      setSelectedCompareAsFocusedRoot();
      return;
    }
    const nodeId = resolveFocusedRootTarget(
      state.fullGraph,
      state.selectedNodeId,
      state.focusedRootNodeIds,
      state.viewMode
    );
    const rootId = nodeId || focusedNetRootId(state.selectedNet);
    if (!rootId || state.compare.active) return;
    if (focusedNetName(rootId)) {
      const commandResult = services.singleViewSession.dispatch({
        type: "focus.set",
        objectRef: services.singleViewSession.objectRefForNet(focusedNetName(rootId))
      });
      if (commandResult.rejected) return;
      services.setSingleTransform({ x: 0, y: 0, scale: 1 });
      services.updateViewControls();
      services.setStatus(`Rebuilding Focused view around net ${focusedNetName(rootId)}…`);
      services.renderCurrentModuleGraph();
      return;
    }
    const fullNode = state.fullGraph.nodes.find((node) => node.id === nodeId);
    const commandResult = services.singleViewSession.dispatch({
      type: "focus.set",
      objectRef: services.singleViewSession.objectRefForNode(fullNode)
    });
    if (commandResult.rejected) return;
    const requestId = ++state.selectionFocusRequestId;
    services.setSingleTransform({ x: 0, y: 0, scale: 1 });
    services.updateViewControls();
    services.setStatus("Rebuilding Focused view around selected cell…");
    services.renderCurrentModuleGraph({
      onRendered: (graph) => {
        if (requestId !== state.selectionFocusRequestId || !state.focusedRootNodeIds.includes(nodeId)) return;
        const node = graph.nodes.find((item) => item.id === nodeId);
        if (!node) return;
        services.setSelectedNode(nodeId);
        services.focusPositionedCell(node, elements.mount, state.transform, services.setSingleTransform);
        services.applyTransform();
        services.setStatus(`Focused neighborhood root: ${node.label}`);
      }
    });
  }

  function setSelectedCompareAsFocusedRoot() {
    const context = getFocusedRootContext();
    if (state.compare.selectedKind === "net" && state.compare.selectedName) {
      const rootId = focusedNetRootId(state.compare.selectedName);
      setCompareFocusedRootNodeIds(context.side, [rootId], rootId);
      services.setCompareTransform(context.side, { x: 0, y: 0, scale: 1 });
      services.updateViewControls();
      services.renderCompareGraphs();
      services.setStatus(`Focused compare ${context.side} view around net ${state.compare.selectedName}`);
      return;
    }
    const node = findCompareNode(context.fullGraph, "cell", state.compare.selectedName);
    if (!node) return;
    setCompareFocusedRootNodeIds(context.side, [node.id], node.id);
    const matchedNode = syncCompareFocusedRootNode(context.side, node.id, "replace");
    services.setCompareTransform(context.side, { x: 0, y: 0, scale: 1 });
    services.updateViewControls();
    services.renderCompareGraphs();
    services.setStatus(`Focused compare ${context.side} view around ${node.label}${state.compare.focusedRootsSynchronized !== false && !matchedNode ? " (no matching cell on other side)" : ""}`);
  }

  function addSelectedAsFocusedRoot() {
    if (state.compare.active) {
      addSelectedCompareAsFocusedRoot();
      return;
    }
    const node = getSelectedSingleCell();
    const rootId = node?.id || focusedNetRootId(state.selectedNet);
    if (!rootId || state.focusedRootNodeIds.includes(rootId)) return;
    const action = services.singleViewSession.dispatch({
      type: "focus.add",
      objectRef: node
        ? services.singleViewSession.objectRefForNode(node)
        : services.singleViewSession.objectRefForNet(state.selectedNet)
    });
    if (action.rejected) { services.setStatus("Focused root limit reached"); return; }
    const requestId = ++state.selectionFocusRequestId;
    services.setSingleTransform({ x: 0, y: 0, scale: 1 });
    services.updateViewControls();
    services.renderCurrentModuleGraph({
      onRendered: (graph) => {
        if (requestId !== state.selectionFocusRequestId || !state.focusedRootNodeIds.includes(rootId)) return;
        const positioned = node ? graph.nodes.find((item) => item.id === node.id) : null;
        if (positioned) services.setSelectedNode(positioned.id);
        services.setStatus(`Added Focused root: ${node?.label || `net ${state.selectedNet}`}`);
      }
    });
  }

  function addSelectedCompareAsFocusedRoot() {
    const context = getFocusedRootContext();
    if (state.compare.selectedKind === "net" && state.compare.selectedName) {
      const rootId = focusedNetRootId(state.compare.selectedName);
      if (context.roots.includes(rootId)) return;
      setCompareFocusedRootNodeIds(context.side, [...context.roots, rootId], rootId);
      services.setCompareTransform(context.side, { x: 0, y: 0, scale: 1 });
      services.updateViewControls();
      services.renderCompareGraphs();
      services.setStatus(`Added net ${state.compare.selectedName} to Compare ${context.side} Focused roots`);
      return;
    }
    const node = findCompareNode(context.fullGraph, "cell", state.compare.selectedName);
    if (!node || context.roots.includes(node.id)) return;
    const action = resolveFocusedRootAction({ rootNodeIds: context.roots }, { type: "add", nodeId: node.id });
    if (action.rejected) { services.setStatus("Focused root limit reached"); return; }
    setCompareFocusedRootNodeIds(context.side, action.rootNodeIds, node.id);
    const matchedNode = syncCompareFocusedRootNode(context.side, node.id, "add");
    services.setCompareTransform(context.side, { x: 0, y: 0, scale: 1 });
    services.updateViewControls();
    services.renderCompareGraphs();
    services.setStatus(`Added ${node.label} to Compare ${context.side} Focused roots${state.compare.focusedRootsSynchronized !== false && !matchedNode ? " (no matching cell on other side)" : ""}`);
  }

  function removeSelectedFromFocusedRoots() {
    if (state.compare.active) {
      removeSelectedCompareFocusedRoot();
      return;
    }
    const nodeId = state.selectedNodeId;
    const rootId = state.selectedNet ? focusedNetRootId(state.selectedNet) : nodeId;
    if (!rootId || !state.focusedRootNodeIds.includes(rootId)) return;
    if (focusedNetName(rootId)) {
      services.singleViewSession.dispatch({
        type: "focus.remove",
        objectRef: services.singleViewSession.objectRefForNet(focusedNetName(rootId))
      });
      const nextRoots = state.focusedRootNodeIds;
      if (nextRoots.length === 0) services.setSingleViewMode(shouldUseSearchFirst(state.currentModule, services.SEARCH_FIRST_NODE_THRESHOLD) ? "search-first" : "whole");
      services.setSingleTransform({ x: 0, y: 0, scale: 1 });
      services.renderCurrentModuleGraph();
      services.setStatus(nextRoots.length ? "Removed selected Focused net root" : "Cleared final Focused root");
      return;
    }
    const fullNode = state.fullGraph?.nodes.find((node) => node.id === nodeId);
    if (!fullNode) return;
    services.singleViewSession.dispatch({
      type: "focus.remove",
      objectRef: services.singleViewSession.objectRefForNode(fullNode)
    });
    const nextRoots = state.focusedRootNodeIds;
    if (nextRoots.length === 0) {
      services.setSingleViewMode(shouldUseSearchFirst(state.currentModule, services.SEARCH_FIRST_NODE_THRESHOLD)
        ? "search-first" : "whole");
    }
    services.setSingleTransform({ x: 0, y: 0, scale: 1 });
    services.renderCurrentModuleGraph();
    services.setStatus(nextRoots.length ? "Removed selected Focused root" : "Cleared final Focused root");
  }

  function removeSelectedCompareFocusedRoot() {
    const context = getFocusedRootContext();
    if (state.compare.selectedKind === "net" && state.compare.selectedName) {
      const rootId = focusedNetRootId(state.compare.selectedName);
      if (!context.roots.includes(rootId)) return;
      const roots = context.roots.filter((item) => item !== rootId);
      setCompareFocusedRootNodeIds(context.side, roots);
      services.setCompareTransform(context.side, { x: 0, y: 0, scale: 1 });
      services.updateViewControls();
      services.renderCompareGraphs();
      services.setStatus(roots.length
        ? `Removed net ${state.compare.selectedName} from Compare ${context.side} Focused roots`
        : `Cleared Compare ${context.side} Focused roots`);
      return;
    }
    const node = findCompareNode(context.fullGraph, "cell", state.compare.selectedName);
    if (!node || !context.roots.includes(node.id)) return;
    const roots = context.roots.filter((nodeId) => nodeId !== node.id);
    setCompareFocusedRootNodeIds(context.side, roots);
    syncCompareFocusedRootNode(context.side, node.id, "remove");
    services.setCompareTransform(context.side, { x: 0, y: 0, scale: 1 });
    services.updateViewControls();
    services.renderCompareGraphs();
    services.setStatus(roots.length
      ? `Removed ${node.label} from Compare ${context.side} Focused roots`
      : `Cleared Compare ${context.side} Focused roots`);
  }

  function clearFocusedRoots() {
    if (state.compare.active) {
      const context = getFocusedRootContext();
      if (context.roots.length === 0) return;
      setCompareFocusedRootNodeIds(context.side, []);
      const activeNodeId = context.activeRootNodeId;
      if (activeNodeId) syncCompareFocusedRootNode(context.side, activeNodeId, "clear");
      services.setCompareTransform(context.side, { x: 0, y: 0, scale: 1 });
      services.updateViewControls();
      services.renderCompareGraphs();
      services.setStatus(`Compare ${context.side} Focused roots cleared`);
      return;
    }
    if (state.focusedRootNodeIds.length === 0) return;
    services.singleViewSession.dispatch({ type: "focus.clear" });
    services.setSingleViewMode(shouldUseSearchFirst(state.currentModule, services.SEARCH_FIRST_NODE_THRESHOLD)
      ? "search-first" : "whole");
    services.setSingleTransform({ x: 0, y: 0, scale: 1 });
    services.renderCurrentModuleGraph();
    services.setStatus("Focused roots cleared");
  }

  function handleFocusedRootListClick(event) {
    if (state.compare.active) {
      handleCompareFocusedRootListClick(event);
      return;
    }
    const removeButton = event.target.closest?.("[data-focused-root-remove]");
    if (removeButton) {
      const nodeId = removeButton.dataset.focusedRootRemove;
      if (!state.focusedRootNodeIds.includes(nodeId)) return;
      const netName = focusedNetName(nodeId);
      if (netName) {
        services.singleViewSession.dispatch({ type: "focus.remove", objectRef: services.singleViewSession.objectRefForNet(netName) });
        if (state.focusedRootNodeIds.length === 0) services.setSingleViewMode(shouldUseSearchFirst(state.currentModule, services.SEARCH_FIRST_NODE_THRESHOLD) ? "search-first" : "whole");
        services.setSingleTransform({ x: 0, y: 0, scale: 1 });
        services.renderCurrentModuleGraph();
        services.setStatus(`Removed Focused root: net ${netName}`);
        return;
      }
      const fullNode = state.fullGraph?.nodes.find((node) => node.id === nodeId);
      if (!fullNode) return;
      services.singleViewSession.dispatch({
        type: "focus.remove",
        objectRef: services.singleViewSession.objectRefForNode(fullNode)
      });
      if (state.focusedRootNodeIds.length === 0) {
        services.setSingleViewMode(shouldUseSearchFirst(state.currentModule, services.SEARCH_FIRST_NODE_THRESHOLD)
          ? "search-first" : "whole");
      }
      services.setSingleTransform({ x: 0, y: 0, scale: 1 });
      services.renderCurrentModuleGraph();
      services.setStatus(`Removed Focused root: ${nodeId}`);
      return;
    }
    const chip = event.target.closest?.("[data-focused-root-activate]");
    const nodeId = chip?.dataset.focusedRootActivate;
    if (!state.focusedRootNodeIds.includes(nodeId)) return;
    const netName = focusedNetName(nodeId);
    if (netName) {
      services.singleViewSession.dispatch({ type: "focus.activate", objectRef: services.singleViewSession.objectRefForNet(netName) });
      const edge = state.graph?.edges.find((item) => item.net === netName);
      if (edge) {
        services.focusPositionedEdge(edge, elements.mount, state.transform, services.setSingleTransform);
        services.applyTransform();
      }
      services.updateViewControls();
      services.setStatus(`Active Focused net root: ${netName}`);
      return;
    }
    const fullNode = state.fullGraph?.nodes.find((node) => node.id === nodeId);
    if (!fullNode) return;
    services.singleViewSession.dispatch({
      type: "focus.activate",
      objectRef: services.singleViewSession.objectRefForNode(fullNode)
    });
    const positioned = state.graph?.nodes.find((node) => node.id === nodeId);
    if (positioned) {
      services.setSelectedNode(nodeId);
      services.focusPositionedCell(positioned, elements.mount, state.transform, services.setSingleTransform);
      services.applyTransform();
      services.updateViewControls();
      services.setStatus(`Active Focused root: ${positioned.label}`);
      return;
    }
    const requestId = ++state.selectionFocusRequestId;
    services.renderCurrentModuleGraph({
      onRendered: (graph) => {
        if (requestId !== state.selectionFocusRequestId || state.activeFocusedRootNodeId !== nodeId) return;
        const node = graph.nodes.find((item) => item.id === nodeId);
        if (!node) return;
        services.setSelectedNode(nodeId);
        services.focusPositionedCell(node, elements.mount, state.transform, services.setSingleTransform);
        services.applyTransform();
        services.setStatus(`Active Focused root: ${node.label}`);
      }
    });
  }

  function handleCompareFocusedRootListClick(event) {
    const context = getFocusedRootContext();
    const removeButton = event.target.closest?.("[data-focused-root-remove]");
    if (removeButton) {
      const nodeId = removeButton.dataset.focusedRootRemove;
      if (!context.roots.includes(nodeId)) return;
      const netName = focusedNetName(nodeId);
      if (netName) {
        setCompareFocusedRootNodeIds(context.side, context.roots.filter((id) => id !== nodeId));
        services.setCompareTransform(context.side, { x: 0, y: 0, scale: 1 });
        services.updateViewControls();
        services.renderCompareGraphs();
        services.setStatus(`Removed Compare ${context.side} Focused net root: ${netName}`);
        return;
      }
      setCompareFocusedRootNodeIds(context.side, context.roots.filter((id) => id !== nodeId));
      syncCompareFocusedRootNode(context.side, nodeId, "remove");
      services.setCompareTransform(context.side, { x: 0, y: 0, scale: 1 });
      services.updateViewControls();
      services.renderCompareGraphs();
      services.setStatus(`Removed Compare ${context.side} Focused root: ${nodeId}`);
      return;
    }
    const chip = event.target.closest?.("[data-focused-root-activate]");
    const nodeId = chip?.dataset.focusedRootActivate;
    if (!context.roots.includes(nodeId)) return;
    const netName = focusedNetName(nodeId);
    if (netName) {
      services.compareViewSessions.dispatch(context.side, {
        type: "focus.activate",
        objectRef: services.compareViewSessions.objectRef(context.side, "net", netName)
      });
      const edge = context.graph?.edges.find((item) => item.net === netName);
      if (edge) {
        const mount = context.side === "left" ? elements.leftMount : elements.rightMount;
        services.focusPositionedEdge(edge, mount, state.compare.transforms[context.side], (transform) => {
          services.setCompareTransform(context.side, transform);
        });
        services.applyCompareTransforms();
        services.selectCompareObject("net", netName, false, context.side);
      }
      services.updateViewControls();
      services.setStatus(`Active Compare ${context.side} Focused net root: ${netName}`);
      return;
    }
    services.compareViewSessions.dispatch(context.side, {
      type: "focus.activate",
      objectRef: services.compareViewSessions.objectRef(context.side, "cell", nodeId)
    });
    const node = context.graph?.nodes.find((item) => item.id === nodeId);
    if (node) {
      const mount = context.side === "left" ? elements.leftMount : elements.rightMount;
      services.focusPositionedCell(node, mount, state.compare.transforms[context.side], (transform) => {
        services.setCompareTransform(context.side, transform);
      });
      services.applyCompareTransforms();
      services.selectCompareObject("cell", getCompareNodeName(node), false, context.side);
    }
    services.updateViewControls();
    services.setStatus(`Active Compare ${context.side} Focused root: ${node?.label || nodeId}`);
  }

  function handleFocusedRootsFilter(event) {
    focusedRootsQuery = String(event.target.value || "").trim().toLocaleLowerCase();
    renderFocusedRootList();
  }

  function renderFocusedRootList() {
    if (!elements.focusedRootsList || !elements.focusedRootCount) return;
    const restoreFocus = captureFocusedRootsFocus(elements.focusedRootsList);
    const context = getFocusedRootContext();
    const roots = context.roots;
    elements.focusedRootCount.value = String(roots.length);
    elements.focusedRootCount.textContent = String(roots.length);
    if (roots.length === 0) {
      elements.focusedRootsList.textContent = "No roots";
      restoreFocus();
      return;
    }
    elements.focusedRootsList.innerHTML = roots.map((nodeId, rootIndex) => {
      const rootRef = context.compare
        ? state.compare.focusedRootRefs?.[context.side]?.[rootIndex]
        : state.focusedRootRefs?.[rootIndex];
      const netName = focusedNetName(nodeId);
      const node = context.fullGraph?.nodes.find((item) => item.id === nodeId);
      const canonicalNetName = rootRef?.kind === "net" ? rootRef.localId : netName;
      const localLabel = canonicalNetName ? `net ${canonicalNetName}` : node?.label || rootRef?.localId || nodeId.replace(/^cell:/, "");
      const occurrencePath = rootRef?.occurrencePath?.join("/") || node?.ref?.occurrencePath?.join("/") ||
        (netName && !context.compare ? state.occurrenceContext?.occurrencePath?.join("/") : "") || "";
      const label = occurrencePath ? `${occurrencePath} · ${localLabel}` : localLabel;
      if (focusedRootsQuery && !`${nodeId} ${label}`.toLocaleLowerCase().includes(focusedRootsQuery)) return "";
      const activeClass = nodeId === context.activeRootNodeId ? " is-active" : "";
      const sideLabel = context.compare ? `${context.side === "left" ? "A" : "B"}: ` : "";
      const title = `${sideLabel}${occurrencePath ? `${occurrencePath} / ` : ""}${localLabel}`;
      return `<span class="focused-root-chip${activeClass}" title="${escapeAttr(title)}"><button type="button" class="focused-root-activate" aria-pressed="${nodeId === context.activeRootNodeId}" data-focused-root-activate="${escapeAttr(nodeId)}"><span>${sideLabel}${escapeHtml(label)}</span></button><button type="button" aria-label="Remove ${escapeAttr(label)} from Focused roots" data-focused-root-remove="${escapeAttr(nodeId)}">×</button></span>`;
    }).join("") || "No matching roots";
    restoreFocus();
  }

  function updateFocusSelectedControl() {
    const singleCell = !state.compare.active && state.fullGraph?.nodes.some(
      (node) => node.id === state.selectedNodeId && node.kind === "cell"
    );
    const singleNet = !state.compare.active && Boolean(state.selectedNet);
    const compareCell = state.compare.active && state.compare.selectedKind === "cell" && Boolean(state.compare.selectedName);
    const compareNet = state.compare.active && state.compare.selectedKind === "net" && Boolean(state.compare.selectedName);
    elements.focusSelectedButton.disabled = !(singleCell || singleNet || compareCell || compareNet);
  }

  function handleFocusSelectedShortcut(event) {
    if (event.key.toLowerCase() !== "f" || event.altKey || event.ctrlKey || event.metaKey || isEditableInputTarget(event.target)) return;
    if (elements.focusSelectedButton.disabled) return;
    event.preventDefault();
    services.focusSelectedCell();
  }

  return Object.freeze({ getSelectedSingleCell, getFocusedRootContext, setCompareFocusedRootNodeIds, syncCompareFocusedRootNode, setSelectedAsFocusedRoot, setSelectedCompareAsFocusedRoot, addSelectedAsFocusedRoot, addSelectedCompareAsFocusedRoot, removeSelectedFromFocusedRoots, removeSelectedCompareFocusedRoot, clearFocusedRoots, handleFocusedRootListClick, handleCompareFocusedRootListClick, handleFocusedRootsFilter, renderFocusedRootList, updateFocusSelectedControl, handleFocusSelectedShortcut });
}

export const focusedRootsPorts = Object.freeze({
  state: [
    "activeFocusedRootNodeId", "compare", "currentModule", "focusedRootNodeIds", "focusedRootRefs",
    "fullGraph", "graph", "occurrenceContext", "selectedNet", "selectedNodeId",
    "selectionFocusRequestId", "transform", "viewMode"
  ],
  elements: [
    "focusSelectedButton", "focusedRootCount", "focusedRootsList", "leftMount", "mount", "rightMount"
  ],
  services: [
    "SEARCH_FIRST_NODE_THRESHOLD", "applyCompareTransforms", "applyTransform", "compareViewSessions",
    "focusPositionedCell", "focusPositionedEdge", "focusSelectedCell", "renderCompareGraphs",
    "renderCurrentModuleGraph", "selectCompareObject", "setCompareTransform", "setSelectedNode",
    "setSingleTransform", "setSingleViewMode", "setStatus", "singleViewSession", "updateViewControls"
  ]
});
