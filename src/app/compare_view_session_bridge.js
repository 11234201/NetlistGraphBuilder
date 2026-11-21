import { snapshotNavigationImport, resolveNavigationImport, projectNavigation, navigationGraph, importViewQuery } from "./view_navigation_import.js";
import { graphNodeToObjectRef, objectRefToNodeId as refToNodeId } from "../domains/netlist/graph_object_refs.js";
import { createViewSessionStore } from "../application/view_session_store.js";
import { createCommandBus } from "../application/command_bus.js";
import { importViewState, initialViewState, compareSideViewState, projectCompareViewState } from "./view_state_import.js";
import { createViewCommandHandlers } from "../application/view_commands.js";
import { createObjectRef } from "../contracts/object_ref.js";
import { hasProjectedValueChange } from "../foundation/structured_value.js";

export function createCompareViewSessionBridge({
  state,
  getDocumentId,
  sessions = createViewSessionStore(),
  onDispatch = null
}) {
  const bus = createCommandBus(createViewCommandHandlers({ sessions }), { onDispatch });
  const sessionIdFor = (side) => `compare:${side}`;

  const pendingNavigation = new Map();
  const initialStates = Object.fromEntries(["left", "right"].map((side) => [side,
    initialViewState({ ...compareSideViewState(state.compare, side), layoutPolicy: state.layoutPolicy,
      presentationPolicy: state.presentationPolicy })]));
  for (const side of ["left", "right"]) projectCompareViewState(state.compare, side, initialStates[side]);
  const policies = () => {
    const source = sessions.get("single:primary") || initialStates.left;
    return { layoutPolicy: source.layoutPolicy, presentationPolicy: source.presentationPolicy };
  };
  // Shared product policies are copied from the canonical Single session when
  // they change, never inferred from a legacy field during pointer commands.
  sessions.subscribe((next) => {
    if (next?.sessionId !== "single:primary") return;
    const patch = { layoutPolicy: next.layoutPolicy, presentationPolicy: next.presentationPolicy };
    for (const side of ["left", "right"]) {
      const current = sessions.get(sessionIdFor(side));
      if (!current || current.documentId !== next.documentId || !hasProjectedValueChange(current, patch)) continue;
      project(side, sessions.update(current.sessionId, () => patch, {
        invalidateComputation: hasProjectedValueChange(current, { layoutPolicy: next.layoutPolicy })
      }));
    }
  });
  const graphFor = (side) => navigationGraph(state.compare.fullGraphs?.[side] || state.compare.graphs?.[side],
    state.compare[`${side}ModuleName`]);
  const importedSide = (value, side) => ({
    focusedRootNodeIds: value.focusedRootNodeIds?.[side] || [],
    focusedRootRefs: value.focusedRootRefs?.[side] || [],
    activeFocusedRootNodeId: value.activeFocusedRootNodeId?.[side],
    selectedObjectRef: value.selectedSide === side && value.selectedName ? objectRefForSelection(graphFor(side),
      { documentId: getDocumentId(), unitId: state.compare[`${side}ModuleName`] },
      value.selectedKind || "cell", value.selectedName) : null
  });

  function project(side, session, select = false) {
    ensureProjectionContainers(state.compare);
    state.compare.showPath = { ...state.compare.showPath, [side]: session.showPath || null };
    projectCompareViewState(state.compare, side, session);
    const value = projectNavigation(session, graphFor(side), pendingNavigation.get(side));
    for (const key of ["focusedRootRefs", "focusedRootNodeIds", "activeFocusedRootNodeId"]) {
      state.compare[key] = Object.freeze({ ...state.compare[key], [side]: value[key] });
    }
    if (select && session.selectedObjectRef) {
      state.compare.selectedKind = session.selectedObjectRef.kind;
      state.compare.selectedName = session.selectedObjectRef.localId;
      state.compare.selectedSide = side;
      state.compare.activeSide = side;
    } else if (!session.selectedObjectRef && state.compare.selectedSide === side) {
      state.compare.selectedKind = null;
      state.compare.selectedName = null;
      state.compare.selectedSide = null;
    }
  }

  function ensure(side) {
    const sessionId = sessionIdFor(side);
    const unitId = side === "left" ? state.compare.leftModuleName : state.compare.rightModuleName;
    const documentId = getDocumentId();
    const current = sessions.get(sessionId);
    if (current && current.documentId === documentId && current.unitId === unitId) return current;
    if (current) sessions.close(sessionId);
    const snapshot = snapshotNavigationImport(current ? {} : importedSide(state.compare, side));
    const graph = graphFor(side);
    if (!graph) pendingNavigation.set(side, snapshot);
    else pendingNavigation.delete(side);
    const navigation = resolveNavigationImport(snapshot, { documentId, unitId }, graph);
    const session = sessions.create({
      sessionId, documentId, domainId: "netlist", unitId,
      viewMode: snapshot.focusedRootNodeIds.length > 0 ? "focused" : "whole",
      ...navigation,
      ...(current ? initialViewState() : initialStates[side]),
      ...policies()
    });
    project(side, session);
    return session;
  }

  function importState(side, value = {}) {
    const current = ensure(side);
    const patch = importViewState(value, current);
    const next = hasProjectedValueChange(current, patch)
      ? sessions.update(current.sessionId, () => patch, {
        invalidateComputation: Boolean(patch.layoutPolicy || patch.overrides)
      }) : current;
    project(side, next);
    return next;
  }

  function dispatch(side, command) {
    const current = ensure(side);
    const result = bus.dispatch({ ...command,
      ...(command.type === "overrides.set" ? { overrides: importViewState({ overrides: command.overrides ?? null }, current).overrides } : {}),
      sessionId: current.sessionId });
    if (command.type.startsWith("focus.") && !result.rejected) pendingNavigation.delete(side);
    if (command.type.startsWith("selection.") && pendingNavigation.has(side)) {
      pendingNavigation.set(side, snapshotNavigationImport({ ...pendingNavigation.get(side),
        selectedObjectRef: result.session.selectedObjectRef }));
    }
    project(side, result.session, command.type === "selection.set" || command.type === "selection.reveal");
    return result;
  }

  function replaceRoots(side, nodeIds, activeNodeId = null) {
    const current = ensure(side);
    const graph = state.compare.fullGraphs?.[side] || state.compare.graphs?.[side];
    const previousRefs = current.focusedRootRefs;
    const previousIds = refsToNodeIds(previousRefs, graph);
    const refs = nodeIds.map((nodeId) => {
      const previous = previousRefs[previousIds.indexOf(nodeId)];
      if (previous) return previous;
      return typeof nodeId === "string" && nodeId.startsWith("net:")
        ? createObjectRef({ documentId: current.documentId, unitId: current.unitId, kind: "net", localId: nodeId.slice(4) })
        : nodeToRef(graph?.nodes?.find((node) => node.id === nodeId), current);
    });
    const activeIndex = nodeIds.indexOf(activeNodeId);
    const result = bus.dispatch({
      type: "focus.replace",
      sessionId: current.sessionId,
      objectRefs: refs,
      activeObjectRef: refs[activeIndex >= 0 ? activeIndex : 0] || null
    });
    const session = result.session;
    const mirrored = {
      rootNodeIds: session.focusedRootRefs.map((ref) => refToNodeId(ref, graph)).filter(Boolean),
      activeRootNodeId: refToNodeId(session.activeFocusedRootRef, graph),
      rejected: result.rejected, effects: result.effects, session
    };
    if (!result.rejected) pendingNavigation.delete(side);
    project(side, session);
    return mirrored;
  }

  function refreshNavigation(side) {
    const current = ensure(side);
    const graph = graphFor(side);
    const pending = pendingNavigation.get(side);
    if (!pending || !graph) { project(side, current); return current; }
    const next = sessions.update(current.sessionId,
      () => resolveNavigationImport(pending, current, graph), { invalidateComputation: false });
    pendingNavigation.delete(side);
    project(side, next);
    return next;
  }

  return Object.freeze({
    setActiveSide(side) {
      if (side !== "left" && side !== "right") throw new Error("Unknown Compare side");
      state.compare.activeSide = side;
    },
    setShowPath(side, showPath) {
      const s = ensure(side);
      project(side, sessions.update(s.sessionId, () => ({ showPath })));
    },
    sessions, ensure, replaceRoots, dispatch, refreshNavigation, importState, readState: ensure,
    isWorkspaceReady: () => Boolean(!state.compare.layoutAbortController && state.compare.workspaceIdentity && state.compare.graphs?.left && state.compare.graphs?.right),
    resetState() {
      pendingNavigation.clear();
      for (const side of ["left", "right"]) {
        sessions.close(sessionIdFor(side));
        initialStates[side] = initialViewState();
        project(side, { ...initialStates[side], focusedRootRefs: [], activeFocusedRootRef: null, selectedObjectRef: null });
      }
    },
    importQuery(query, workspaceInputs = null) {
      for (const side of ["left", "right"]) {
        const current = ensure(side);
        const nextQuery = importViewQuery({ coneDepth: query.coneDepth,
          faninDepth: query.faninDepth, fanoutDepth: query.fanoutDepth,
          ...(workspaceInputs ? { viewMode: "whole", ...workspaceInputs[side] } : {})
        }, current);
        if (hasProjectedValueChange(current, nextQuery)) sessions.update(current.sessionId, () => nextQuery);
      }
    },
    importNavigation(value = {}) {
      for (const side of ["left", "right"]) {
        const current = ensure(side);
        const snapshot = snapshotNavigationImport(importedSide(value, side));
        const graph = graphFor(side);
        const next = sessions.update(current.sessionId, () => ({
          showPath: value.showPath?.[side] || null,
          ...resolveNavigationImport(snapshot, current, graph),
          viewMode: snapshot.focusedRootNodeIds.length ? "focused" : "whole",
          ...importViewState(compareSideViewState(value, side), current)
        }));
        if (graph) pendingNavigation.delete(side); else pendingNavigation.set(side, snapshot);
        project(side, next, value.selectedSide === side);
      }
    },
    beginComputation(side) {
      const current = refreshNavigation(side);
      return sessions.update(current.sessionId, () => ({}));
    },
    objectRef(side, kind, localId) {
      const session = ensure(side);
      const graph = state.compare.fullGraphs?.[side] || state.compare.graphs?.[side];
      if (kind === "net") {
        const netNode = findGraphNetNode(graph, localId);
        return createObjectRef({
          documentId: session.documentId,
          unitId: session.unitId,
          kind,
          localId,
          occurrencePath: netNode?.ref?.occurrencePath
        });
      }
      const node = findGraphNode(graph, kind, localId);
      if (node) return nodeToRef(node, session);
      return createObjectRef({ documentId: session.documentId, unitId: session.unitId, kind, localId });
    }
  });
}

function objectRefForSelection(graph, session, kind, localId) {
  if (kind === "net") {
    const netNode = findGraphNetNode(graph, localId);
    return createObjectRef({
      documentId: session.documentId,
      unitId: session.unitId,
      kind,
      localId,
      occurrencePath: netNode?.ref?.occurrencePath
    });
  }
  const node = findGraphNode(graph, kind, localId);
  if (node) return nodeToRef(node, session);
  return createObjectRef({ documentId: session.documentId, unitId: session.unitId, kind, localId });
}

function findGraphNode(graph, kind, localId) {
  return graph?.nodes?.find((node) => {
    if (kind === "net") return false;
    if (node.kind !== kind && !(kind === "cell" && node.kind === "cell")) return false;
    return node.id === localId ||
      node.ref?.instance === localId ||
      node.ref?.name === localId ||
      node.ref?.localId === localId;
  }) || null;
}

function findGraphNetNode(graph, localId) {
  return graph?.nodes?.find((node) =>
    (node.kind === "hub" || node.kind === "net") &&
    (node.ref?.localId || node.ref?.name || node.label) === localId
  ) || null;
}

function ensureProjectionContainers(compare) {
  compare.transforms ||= { left: { x: 0, y: 0, scale: 1 }, right: { x: 0, y: 0, scale: 1 } };
  compare.nodePositions ||= { left: new Map(), right: new Map() };
  compare.nodeSizes ||= { left: new Map(), right: new Map() };
  compare.graphOverrides ||= {
    left: { nodeProperties: {}, cellPinDirections: {} },
    right: { nodeProperties: {}, cellPinDirections: {} }
  };
  compare.focusedRootNodeIds ||= { left: [], right: [] };
  compare.focusedRootRefs ||= { left: [], right: [] };
  compare.activeFocusedRootNodeId ||= { left: null, right: null };
}

function refsToNodeIds(refs, graph) {
  return (Array.isArray(refs) ? refs : []).map((ref) => refToNodeId(ref, graph)).filter(Boolean);
}

function nodeToRef(node, session) {
  return graphNodeToObjectRef(node, { documentId: session.documentId, unitId: session.unitId });
}
