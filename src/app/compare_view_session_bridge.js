import { createViewSessionStore } from "../application/view_session_store.js";
import { createCommandBus } from "../application/command_bus.js";
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

  function ensure(side) {
    const sessionId = sessionIdFor(side);
    const unitId = side === "left" ? state.compare.leftModuleName : state.compare.rightModuleName;
    const documentId = getDocumentId();
    const current = sessions.get(sessionId);
    if (current && current.documentId === documentId && current.unitId === unitId) return current;
    if (current) sessions.close(sessionId);
    const graph = state.compare.fullGraphs?.[side] || state.compare.graphs?.[side];
    const focusedRootRefs = rootsToRefs(state.compare.focusedRootNodeIds?.[side], graph, { documentId, unitId });
    const activeFocusedRootRef = focusedRootRefs.find((ref) =>
      refToNodeId(ref, graph) === state.compare.activeFocusedRootNodeId?.[side]
    ) || focusedRootRefs[0] || null;
    return sessions.create({
      sessionId, documentId, domainId: "netlist", unitId,
      viewMode: focusedRootRefs.length > 0 ? "focused" : "whole",
      focusedRootRefs,
      activeFocusedRootRef,
      viewport: state.compare.transforms?.[side] || { x: 0, y: 0, scale: 1 },
      layoutPolicy: state.layoutPolicy,
      presentationPolicy: state.presentationPolicy,
      overrides: snapshotOverrides(state.compare, side)
    });
  }

  function synchronize(side) {
    const current = ensure(side);
    const graph = state.compare.fullGraphs?.[side] || state.compare.graphs?.[side];
    const focusedRootRefs = rootsToRefs(state.compare.focusedRootNodeIds?.[side], graph, current);
    const activeFocusedRootRef = focusedRootRefs.find((ref) =>
      refToNodeId(ref, graph) === state.compare.activeFocusedRootNodeId?.[side]
    ) || focusedRootRefs[0] || null;
    const projection = {
      viewMode: focusedRootRefs.length > 0 ? "focused" : "whole",
      focusedRootRefs,
      activeFocusedRootRef,
      viewport: state.compare.transforms?.[side] || current.viewport,
      layoutPolicy: state.layoutPolicy,
      presentationPolicy: state.presentationPolicy,
      overrides: snapshotOverrides(state.compare, side),
      selectedObjectRef: state.compare.selectedSide === side && state.compare.selectedName
        ? objectRefForSelection(graph, current, state.compare.selectedKind || "cell", state.compare.selectedName)
        : null
    };
    return hasProjectedValueChange(current, projection)
      ? sessions.update(current.sessionId, () => projection, { invalidateComputation: false })
      : current;
  }

  function dispatch(side, command) {
    const current = synchronize(side);
    const result = bus.dispatch({ ...command, sessionId: current.sessionId });
    const graph = state.compare.fullGraphs?.[side] || state.compare.graphs?.[side];
    ensureProjectionContainers(state.compare);
    state.compare.transforms[side] = { ...result.session.viewport };
    state.layoutPolicy = result.session.layoutPolicy;
    state.presentationPolicy = { ...result.session.presentationPolicy };
    applyOverridesSnapshot(state.compare, side, result.session.overrides);
    if (!state.compare.focusedRootNodeIds) state.compare.focusedRootNodeIds = { left: [], right: [] };
    if (!state.compare.activeFocusedRootNodeId) state.compare.activeFocusedRootNodeId = { left: null, right: null };
    state.compare.focusedRootNodeIds[side] = result.session.focusedRootRefs
      .map((ref) => refToNodeId(ref, graph))
      .filter(Boolean);
    state.compare.activeFocusedRootNodeId[side] = refToNodeId(result.session.activeFocusedRootRef, graph);
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
    const refs = nodeIds.map((nodeId) => typeof nodeId === "string" && nodeId.startsWith("net:")
      ? createObjectRef({ documentId: current.documentId, unitId: current.unitId, kind: "net", localId: nodeId.slice(4) })
      : nodeToRef(graph?.nodes?.find((node) => node.id === nodeId), current));
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
      session
    };
    ensureProjectionContainers(state.compare);
    state.compare.focusedRootNodeIds[side] = mirrored.rootNodeIds;
    state.compare.activeFocusedRootNodeId[side] = mirrored.activeRootNodeId;
    return mirrored;
  }

  return Object.freeze({
    sessions, ensure, replaceRoots, dispatch,
    beginComputation(side) {
      const current = synchronize(side);
      return sessions.update(current.sessionId, () => ({}));
    },
    objectRef(side, kind, localId) {
      const session = ensure(side);
      const graph = state.compare.fullGraphs?.[side] || state.compare.graphs?.[side];
      const node = findGraphNode(graph, kind, localId);
      if (node) return nodeToRef(node, session);
      return createObjectRef({ documentId: session.documentId, unitId: session.unitId, kind, localId });
    }
  });
}

function objectRefForSelection(graph, session, kind, localId) {
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

function ensureProjectionContainers(compare) {
  compare.transforms ||= { left: { x: 0, y: 0, scale: 1 }, right: { x: 0, y: 0, scale: 1 } };
  compare.nodePositions ||= { left: new Map(), right: new Map() };
  compare.nodeSizes ||= { left: new Map(), right: new Map() };
  compare.graphOverrides ||= {
    left: { nodeProperties: {}, cellPinDirections: {} },
    right: { nodeProperties: {}, cellPinDirections: {} }
  };
  compare.focusedRootNodeIds ||= { left: [], right: [] };
  compare.activeFocusedRootNodeId ||= { left: null, right: null };
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
    localId: node.ref?.instance || node.ref?.name || node.ref?.localId || node.id,
    occurrencePath: node.ref?.occurrencePath
  });
}

function rootsToRefs(nodeIds, graph, session) {
  return (nodeIds || [])
    .map((nodeId) => {
      if (typeof nodeId === "string" && nodeId.startsWith("net:")) {
        const localId = nodeId.slice(4);
        const netNode = graph?.nodes?.find((item) =>
          (item.kind === "hub" || item.kind === "net") &&
          (item.ref?.localId || item.ref?.name || item.label) === localId
        );
        return createObjectRef({
          documentId: session.documentId,
          unitId: session.unitId,
          kind: "net",
          localId,
          occurrencePath: netNode?.ref?.occurrencePath
        });
      }
      const node = graph?.nodes?.find((item) => item.id === nodeId);
      return node ? nodeToRef(node, session) : null;
    })
    .filter(Boolean);
}

function refToNodeId(ref, graph) {
  if (!ref || !graph) return null;
  if (ref.kind === "net") return `net:${ref.localId}`;
  return graph.nodes.find((node) =>
    (node.ref?.instance || node.ref?.name || node.ref?.localId || node.id) === ref.localId &&
    (node.kind === ref.kind || (ref.kind === "cell" && node.kind === "cell")) &&
    occurrenceMatches(node.ref?.occurrencePath, ref.occurrencePath)
  )?.id || null;
}

function occurrenceMatches(nodePath, refPath) {
  if (!Array.isArray(refPath) || refPath.length === 0) return true;
  return Array.isArray(nodePath) && nodePath.length === refPath.length &&
    nodePath.every((segment, index) => segment === refPath[index]);
}
