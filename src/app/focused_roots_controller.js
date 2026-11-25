import { resetCompareRootViewport } from "./compare_sync_settings.js";
import { createFocusedRootList } from "../ui/focused_root_list.js";
import { resolveFocusedRootContext } from "./focused_root_context.js";
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
import { handleFocusShortcut } from "../ui/focus_shortcut.js";
import { runFocusedViewCommand } from "../application/focused_view_command.js";
import { executeViewEffects, mergeViewEffects } from "../application/view_effects.js";

// Legacy workbench adapter. State and elements are restricted ports supplied
// by the composition root; peer actions are explicit, late-bound services.
export function createFocusedRootsController({ state, elements, services }) {
  const getFocusedRootContext = (side) => resolveFocusedRootContext(state, side);
  const { renderFocusedRootList, handleFocusedRootsFilter } = createFocusedRootList({
    elements, readContext: getFocusedRootContext, netNameForRoot: focusedNetName,
    readRefs: (side) => side ? state.compare.focusedRootRefs?.[side] : state.focusedRootRefs,
    readOccurrence: () => state.occurrenceContext?.occurrencePath
  });

  function runSingleFocusedCommand(command, options = {}) {
    return runFocusedViewCommand({
      command,
      dispatch: (value) => {
        const result = services.singleViewSession.dispatch(value);
        if (!result.rejected && ["focus.remove", "focus.clear"].includes(value.type) && !state.focusedRootNodeIds.length) {
          const mode = services.setSingleViewMode(shouldUseSearchFirst(state.currentModule, services.SEARCH_FIRST_NODE_THRESHOLD)
            ? "search-first" : "whole");
          return { ...result, effects: mergeViewEffects(result.effects, mode?.effects) };
        }
        return result;
      },
      readGraph: () => state.graph,
      isReady: () => services.singleViewSession.isWorkspaceReady(),
      resetViewport: () => services.setSingleTransform({ x: 0, y: 0, scale: 1 }),
      rebuild: (callbacks) => services.renderCurrentModuleGraph(callbacks),
      ...options,
      onAccepted: (result) => { services.updateViewControls(); options.onAccepted?.(result); }
    });
  }

  function getSelectedSingleCell() {
    return state.fullGraph?.nodes.find(
      (node) => node.id === state.selectedNodeId && node.kind === "cell"
    ) || null;
  }

  function setCompareFocusedRootNodeIds(side, value, activeRootNodeId = null) {
    const resolved = resolveFocusedRootState(value, activeRootNodeId, state.compare.activeFocusedRootNodeId[side]);
    const mirrored = services.compareViewSessions.replaceRoots(side, resolved.rootNodeIds, resolved.activeRootNodeId);
    const outputChanged = Boolean(state.compare.outputName);
    state.compare.outputName = null;
    return { ...mirrored, effects: mergeViewEffects(mirrored.effects,
      outputChanged ? { query: true, layout: true, render: true, persist: true } : null) };
  }

  function applyCompareFocusedEffects(side, results) {
    return executeViewEffects({ effects: mergeViewEffects(...results.map((result) => result?.effects)) }, {
      requireReady: true, isReady: () => services.compareViewSessions.isWorkspaceReady(),
      beforeCompute: () => resetCompareRootViewport(state.compare, side, services.setCompareTransform),
      compute: ({ onRendered, ...callbacks }) => services.renderCompareGraphs({ ...callbacks, onCommitted: onRendered }),
      render: () => services.updateViewControls()
    });
  }

  function syncCompareFocusedRootNode(side, nodeId, operation, results = []) {
    if (state.compare.focusedRootsSynchronized === false) return null;
    const oppositeSide = side === "left" ? "right" : "left";
    if (operation === "clear") {
      results.push(setCompareFocusedRootNodeIds(oppositeSide, []));
      return null;
    }
    const sourceNode = state.compare.fullGraphs?.[side]?.nodes.find((node) => node.id === nodeId);
    const oppositeGraph = state.compare.fullGraphs?.[oppositeSide] || state.compare.graphs?.[oppositeSide];
    const oppositeNode = findCompareNode(oppositeGraph, "cell", getCompareNodeName(sourceNode));
    if (!oppositeNode) return null;
    const currentRoots = normalizeFocusedSelectionRoots(state.compare.focusedRootNodeIds?.[oppositeSide]);
    if (operation === "replace") {
      results.push(setCompareFocusedRootNodeIds(oppositeSide, [oppositeNode.id], oppositeNode.id));
    } else if (operation === "remove") {
      results.push(setCompareFocusedRootNodeIds(oppositeSide, currentRoots.filter((id) => id !== oppositeNode.id)));
    } else if (operation === "add") {
      results.push(setCompareFocusedRootNodeIds(oppositeSide, addFocusedRootNodeId(currentRoots, oppositeNode.id), oppositeNode.id));
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
      return runSingleFocusedCommand({
        type: "focus.set",
        objectRef: services.singleViewSession.objectRefForNet(focusedNetName(rootId))
      }, {
        onAccepted: () => services.setStatus(`Focused view around net ${focusedNetName(rootId)}`)
      });
    }
    const fullNode = state.fullGraph.nodes.find((node) => node.id === nodeId);
    const requestId = ++state.selectionFocusRequestId;
    return runSingleFocusedCommand({
      type: "focus.set",
      objectRef: services.singleViewSession.objectRefForNode(fullNode)
    }, {
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
      applyCompareFocusedEffects(context.side, [setCompareFocusedRootNodeIds(context.side, [rootId], rootId)]);
      services.setStatus(`Focused compare ${context.side} view around net ${state.compare.selectedName}`);
      return;
    }
    const node = findCompareNode(context.fullGraph, "cell", state.compare.selectedName);
    if (!node) return;
    const results = [setCompareFocusedRootNodeIds(context.side, [node.id], node.id)];
    const matchedNode = syncCompareFocusedRootNode(context.side, node.id, "replace", results);
    applyCompareFocusedEffects(context.side, results);
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
    const requestId = ++state.selectionFocusRequestId;
    return runSingleFocusedCommand({
      type: "focus.add",
      objectRef: node
        ? services.singleViewSession.objectRefForNode(node)
        : services.singleViewSession.objectRefForNet(state.selectedNet)
    }, {
      onRejected: () => services.setStatus("Focused root limit reached"),
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
      applyCompareFocusedEffects(context.side, [setCompareFocusedRootNodeIds(context.side, [...context.roots, rootId], rootId)]);
      services.setStatus(`Added net ${state.compare.selectedName} to Compare ${context.side} Focused roots`);
      return;
    }
    const node = findCompareNode(context.fullGraph, "cell", state.compare.selectedName);
    if (!node || context.roots.includes(node.id)) return;
    const action = resolveFocusedRootAction({ rootNodeIds: context.roots }, { type: "add", nodeId: node.id });
    if (action.rejected) { services.setStatus("Focused root limit reached"); return; }
    const results = [setCompareFocusedRootNodeIds(context.side, action.rootNodeIds, node.id)];
    const matchedNode = syncCompareFocusedRootNode(context.side, node.id, "add", results);
    applyCompareFocusedEffects(context.side, results);
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
    const netName = focusedNetName(rootId);
    const fullNode = state.fullGraph?.nodes.find((node) => node.id === nodeId);
    if (!netName && !fullNode) return;
    return runSingleFocusedCommand({
      type: "focus.remove",
      objectRef: netName ? services.singleViewSession.objectRefForNet(netName) : services.singleViewSession.objectRefForNode(fullNode)
    }, {
      onAccepted: () => services.setStatus(state.focusedRootNodeIds.length ? "Removed selected Focused root" : "Cleared final Focused root")
    });
  }

  function removeSelectedCompareFocusedRoot() {
    const context = getFocusedRootContext();
    if (state.compare.selectedKind === "net" && state.compare.selectedName) {
      const rootId = focusedNetRootId(state.compare.selectedName);
      if (!context.roots.includes(rootId)) return;
      const roots = context.roots.filter((item) => item !== rootId);
      applyCompareFocusedEffects(context.side, [setCompareFocusedRootNodeIds(context.side, roots)]);
      services.setStatus(roots.length
        ? `Removed net ${state.compare.selectedName} from Compare ${context.side} Focused roots`
        : `Cleared Compare ${context.side} Focused roots`);
      return;
    }
    const node = findCompareNode(context.fullGraph, "cell", state.compare.selectedName);
    if (!node || !context.roots.includes(node.id)) return;
    const roots = context.roots.filter((nodeId) => nodeId !== node.id);
    const results = [setCompareFocusedRootNodeIds(context.side, roots)];
    syncCompareFocusedRootNode(context.side, node.id, "remove", results);
    applyCompareFocusedEffects(context.side, results);
    services.setStatus(roots.length
      ? `Removed ${node.label} from Compare ${context.side} Focused roots`
      : `Cleared Compare ${context.side} Focused roots`);
  }

  function clearFocusedRoots(requestedSide) {
    if (state.compare.active) {
      const side = ["left","right"].includes(requestedSide) ? requestedSide : getFocusedRootContext().side;
      const context = {side,roots:state.compare.focusedRootNodeIds[side],activeRootNodeId:state.compare.activeFocusedRootNodeId[side]};
      if (context.roots.length === 0) return;
      const results = [setCompareFocusedRootNodeIds(context.side, [])];
      const activeNodeId = context.activeRootNodeId;
      if (activeNodeId) syncCompareFocusedRootNode(context.side, activeNodeId, "clear", results);
      applyCompareFocusedEffects(context.side, results);
      services.setStatus(`Compare ${context.side} Focused roots cleared`);
      return;
    }
    if (state.focusedRootNodeIds.length === 0) return;
    return runSingleFocusedCommand({ type: "focus.clear" }, {
      onAccepted: () => services.setStatus("Focused roots cleared")
    });
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
      const fullNode = state.fullGraph?.nodes.find((node) => node.id === nodeId);
      if (!netName && !fullNode) return;
      return runSingleFocusedCommand({
        type: "focus.remove",
        objectRef: netName ? services.singleViewSession.objectRefForNet(netName) : services.singleViewSession.objectRefForNode(fullNode)
      }, {
        onAccepted: () => services.setStatus(`Removed Focused root: ${netName ? `net ${netName}` : nodeId}`)
      });
    }
    const chip = event.target.closest?.("[data-focused-root-activate]");
    return activateSingleFocusedRoot(chip?.dataset.focusedRootActivate);
  }
  function activateSingleFocusedRoot(nodeId) {
    if (!state.focusedRootNodeIds.includes(nodeId)) return;
    const netName = focusedNetName(nodeId);
    const fullNode = state.fullGraph?.nodes.find((node) => node.id === nodeId);
    if (!netName && !fullNode) return;
    const result = services.singleViewSession.dispatch({
      type: "focus.activate",
      objectRef: netName ? services.singleViewSession.objectRefForNet(netName) : services.singleViewSession.objectRefForNode(fullNode)
    });
    const positioned = state.graph?.nodes.find((node) => node.id === nodeId);
    const requestId = ++state.selectionFocusRequestId;
    const activate = (graph = state.graph) => {
        if (requestId !== state.selectionFocusRequestId || state.activeFocusedRootNodeId !== nodeId) return;
        if (netName) {
          const edge = graph?.edges.find((item) => item.net === netName);
          if (edge) {
            services.focusPositionedEdge(edge, elements.mount, state.transform, services.setSingleTransform);
            services.applyTransform();
          }
          services.updateViewControls();
          services.setStatus(`Active Focused net root: ${netName}`);
          return;
        }
        const node = graph.nodes.find((item) => item.id === nodeId);
        if (!node) return;
        services.setSelectedNode(nodeId);
        services.focusPositionedCell(node, elements.mount, state.transform, services.setSingleTransform);
        services.applyTransform();
        services.updateViewControls();
        services.setStatus(`Active Focused root: ${node.label}`);
    };
    return executeViewEffects(result, {
      shouldCompute: !netName && !positioned,
      requireReady: true, isReady: () => services.singleViewSession.isWorkspaceReady(),
      compute: (callbacks) => services.renderCurrentModuleGraph(callbacks),
      onCommitted: activate,
      onUnchanged: activate
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
        applyCompareFocusedEffects(context.side, [setCompareFocusedRootNodeIds(context.side, context.roots.filter((id) => id !== nodeId))]);
        services.setStatus(`Removed Compare ${context.side} Focused net root: ${netName}`);
        return;
      }
      const results = [setCompareFocusedRootNodeIds(context.side, context.roots.filter((id) => id !== nodeId))];
      syncCompareFocusedRootNode(context.side, nodeId, "remove", results);
      applyCompareFocusedEffects(context.side, results);
      services.setStatus(`Removed Compare ${context.side} Focused root: ${nodeId}`);
      return;
    }
    const chip = event.target.closest?.("[data-focused-root-activate]");
    return activateCompareFocusedRoot(context, chip?.dataset.focusedRootActivate);
  }
  function activateCompareFocusedRoot(context, nodeId) {
    if (!context.roots.includes(nodeId)) return;
    const netName = focusedNetName(nodeId);
    if (netName) {
      const result = services.compareViewSessions.dispatch(context.side, {
        type: "focus.activate",
        objectRef: services.compareViewSessions.objectRef(context.side, "net", netName)
      });
      return executeViewEffects(result, {
        requireReady: true, isReady: () => services.compareViewSessions.isWorkspaceReady(),
        compute: ({ onRendered, ...callbacks }) => services.renderCompareGraphs({ ...callbacks, onCommitted: onRendered }),
        render: () => services.updateViewControls(),
        viewport: () => {
          const edge = state.compare.graphs[context.side]?.edges.find((item) => item.net === netName);
          if (!edge) return;
          const mount = context.side === "left" ? elements.leftMount : elements.rightMount;
          services.focusPositionedEdge(edge, mount, state.compare.transforms[context.side], (transform) => {
            services.setCompareTransform(context.side, transform, false);
          });
          services.applyCompareTransforms();
          services.selectCompareObject("net", netName, false, context.side);
        },
        onCommitted: () => services.setStatus(`Active Compare ${context.side} Focused net root: ${netName}`)
      });
    }
    const result = services.compareViewSessions.dispatch(context.side, {
      type: "focus.activate",
      objectRef: services.compareViewSessions.objectRef(context.side, "cell", nodeId)
    });
    return executeViewEffects(result, {
      requireReady: true, isReady: () => services.compareViewSessions.isWorkspaceReady(),
      compute: ({ onRendered, ...callbacks }) => services.renderCompareGraphs({ ...callbacks, onCommitted: onRendered }),
      render: () => services.updateViewControls(),
      viewport: () => {
        const node = state.compare.graphs[context.side]?.nodes.find((item) => item.id === nodeId);
        if (!node) return;
        const mount = context.side === "left" ? elements.leftMount : elements.rightMount;
        services.focusPositionedCell(node, mount, state.compare.transforms[context.side], (transform) => {
          services.setCompareTransform(context.side, transform, false);
        });
        services.applyCompareTransforms();
        services.selectCompareObject("cell", getCompareNodeName(node), false, context.side);
      },
      onCommitted: () => services.setStatus(`Active Compare ${context.side} Focused root: ${state.compare.graphs[context.side]?.nodes.find((item) => item.id === nodeId)?.label || nodeId}`)
    });
  }

  function updateFocusSelectedControl() {
    const singleCell = !state.compare.active && state.fullGraph?.nodes.some(
      (node) => node.id === state.selectedNodeId && node.kind === "cell"
    );
    const singleNet = !state.compare.active && Boolean(state.selectedNet);
    const compareObject = state.compare.active && ["cell", "net", "port"].includes(state.compare.selectedKind)
      && Boolean(state.compare.selectedName);
    elements.focusSelectedButton.disabled = !(singleCell || singleNet || compareObject);
  }

  function handleFocusSelectedShortcut(event) {
    handleFocusShortcut(event, services.focusSelectedCell, !elements.focusSelectedButton.disabled);
  }

  function changeFocusedRoots(operation, ids, side) {
    const old = side ? state.compare.focusedRootNodeIds[side] : state.focusedRootNodeIds;
    if (operation === "activate") return side ? activateCompareFocusedRoot({side, roots:old,
      fullGraph:state.compare.fullGraphs[side]},ids[0]) : activateSingleFocusedRoot(ids[0]);
    const roots = operation === "remove" ? old.filter(id => !ids.includes(id)) :
      [...new Set([...(operation === "add" ? old : []), ...ids])];
    if (normalizeFocusedSelectionRoots(roots).length !== roots.length)
      throw Object.assign(new Error("Focused root limit exceeded"), {code:"FOCUS_LIMIT"});
    const active = operation === "remove" ? roots[0] : ids.at(-1);
    if (side) {
      const results = [setCompareFocusedRootNodeIds(side, roots, active)];
      if (operation === "replace") syncCompareFocusedRootNode(side, null, "clear", results);
      for (const id of ids)
        if (!focusedNetName(id)) syncCompareFocusedRootNode(side, id, operation === "remove" ? "remove" : "add", results);
      return applyCompareFocusedEffects(side, results);
    }
    if (!roots.length) return runSingleFocusedCommand({type:"focus.clear"});
    const refs = roots.map(id => focusedNetName(id) ? services.singleViewSession.objectRefForNet(focusedNetName(id)) :
      services.singleViewSession.objectRefForNode(state.fullGraph?.nodes.find(node => node.id === id)));
    if (refs.some(ref => !ref)) throw Object.assign(new Error("Focused object no longer exists"), {code:"OBJECT_NOT_FOUND"});
    return runSingleFocusedCommand({ type:"focus.replace", objectRefs:refs, activeObjectRef:refs[roots.indexOf(active)] });
  }

  return Object.freeze({ changeFocusedRoots, getSelectedSingleCell, getFocusedRootContext, setCompareFocusedRootNodeIds, syncCompareFocusedRootNode, setSelectedAsFocusedRoot, setSelectedCompareAsFocusedRoot, addSelectedAsFocusedRoot, addSelectedCompareAsFocusedRoot, removeSelectedFromFocusedRoots, removeSelectedCompareFocusedRoot, clearFocusedRoots, handleFocusedRootListClick, handleCompareFocusedRootListClick, handleFocusedRootsFilter, renderFocusedRootList, updateFocusSelectedControl, handleFocusSelectedShortcut });
}

export const focusedRootsPorts = Object.freeze({
  historyActions: {
    "setSelectedAsFocusedRoot": "Set Focused root",
    "addSelectedAsFocusedRoot": "Add Focused root",
    "removeSelectedFromFocusedRoots": "Remove Focused root",
    "clearFocusedRoots": "Clear Focused roots",
    "handleFocusedRootListClick": "Change Focused roots"
  },
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
