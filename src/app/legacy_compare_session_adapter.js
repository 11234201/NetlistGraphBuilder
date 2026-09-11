import { createViewSessionStore } from "../application/view_session_store.js";
import { createCommandBus } from "../application/command_bus.js";
import { createViewCommandHandlers } from "../application/view_commands.js";
import { createObjectRef } from "../contracts/object_ref.js";

export function createLegacyCompareSessionAdapter({ state, getDocumentId }) {
  const sessions = createViewSessionStore();
  const bus = createCommandBus(createViewCommandHandlers({ sessions }));
  const sessionIdFor = (side) => `compare:${side}`;

  function ensure(side) {
    const sessionId = sessionIdFor(side);
    const unitId = side === "left" ? state.compare.leftModuleName : state.compare.rightModuleName;
    const documentId = getDocumentId();
    const current = sessions.get(sessionId);
    if (current && current.documentId === documentId && current.unitId === unitId) return current;
    if (current) sessions.close(sessionId);
    return sessions.create({
      sessionId, documentId, domainId: "netlist", unitId,
      viewport: state.compare.transforms?.[side] || { x: 0, y: 0, scale: 1 },
      layoutPolicy: state.layoutPolicy,
      overrides: snapshotOverrides(state.compare, side)
    });
  }

  function synchronize(side) {
    const current = ensure(side);
    return sessions.update(current.sessionId, () => ({
      viewport: state.compare.transforms?.[side] || current.viewport,
      layoutPolicy: state.layoutPolicy,
      overrides: snapshotOverrides(state.compare, side),
      selectedObjectRef: state.compare.selectedSide === side && state.compare.selectedName
        ? createObjectRef({
          documentId: current.documentId,
          unitId: current.unitId,
          kind: state.compare.selectedKind || "cell",
          localId: state.compare.selectedName
        })
        : null
    }), { invalidateComputation: false });
  }

  function dispatch(side, command) {
    const current = synchronize(side);
    const result = bus.dispatch({ ...command, sessionId: current.sessionId });
    state.compare.transforms[side] = { ...result.session.viewport };
    state.layoutPolicy = result.session.layoutPolicy;
    applyOverridesSnapshot(state.compare, side, result.session.overrides);
    if (result.session.selectedObjectRef) {
      state.compare.selectedKind = result.session.selectedObjectRef.kind;
      state.compare.selectedName = result.session.selectedObjectRef.localId;
      state.compare.selectedSide = side;
    } else if (state.compare.selectedSide === side) {
      state.compare.selectedKind = null;
      state.compare.selectedName = null;
      state.compare.selectedSide = null;
    }
    return result;
  }

  function replaceRoots(side, nodeIds, activeNodeId = null) {
    const current = ensure(side);
    const graph = state.compare.fullGraphs?.[side] || state.compare.graphs?.[side];
    const refs = nodeIds.map((nodeId) => nodeToRef(graph?.nodes?.find((node) => node.id === nodeId), current));
    const activeIndex = nodeIds.indexOf(activeNodeId);
    const session = sessions.update(current.sessionId, () => ({
      viewMode: refs.length > 0 ? "focused" : "whole",
      focusedRootRefs: refs,
      activeFocusedRootRef: refs[activeIndex >= 0 ? activeIndex : 0] || null
    }));
    return {
      rootNodeIds: refs.map((ref) => ref.localId),
      activeRootNodeId: session.activeFocusedRootRef?.localId || null,
      session
    };
  }

  return Object.freeze({
    sessions, ensure, replaceRoots, dispatch,
    objectRef(side, kind, localId) {
      const session = ensure(side);
      return createObjectRef({ documentId: session.documentId, unitId: session.unitId, kind, localId });
    }
  });
}

function snapshotOverrides(compare, side) {
  return {
    nodePositions: new Map(compare.nodePositions?.[side] || []),
    nodeSizes: new Map(compare.nodeSizes?.[side] || []),
    graphOverrides: cloneGraphOverrides(compare.graphOverrides?.[side])
  };
}

function applyOverridesSnapshot(compare, side, snapshot) {
  if (!snapshot) return;
  compare.nodePositions[side] = new Map(snapshot.nodePositions || []);
  compare.nodeSizes[side] = new Map(snapshot.nodeSizes || []);
  compare.graphOverrides[side] = cloneGraphOverrides(snapshot.graphOverrides);
}

function cloneGraphOverrides(value) {
  return {
    nodeProperties: Object.fromEntries(Object.entries(value?.nodeProperties || {}).map(([id, properties]) => [id, { ...properties }])),
    cellPinDirections: Object.fromEntries(Object.entries(value?.cellPinDirections || {}).map(([id, pins]) => [id, { ...pins }]))
  };
}

function nodeToRef(node, session) {
  if (!node) throw new Error("Compare root node is not available in its session graph");
  return createObjectRef({
    documentId: session.documentId,
    unitId: session.unitId,
    kind: node.kind === "cell" ? "cell" : node.kind,
    localId: node.id
  });
}
