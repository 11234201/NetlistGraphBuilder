import { createCommandBus } from "../application/command_bus.js";
import { createViewCommandHandlers } from "../application/view_commands.js";
import { createViewSessionStore } from "../application/view_session_store.js";
import { createObjectRef, objectRefKey } from "../contracts/object_ref.js";
import { DEFAULT_FOCUSED_VIEW_POLICY } from "../foundation/view_policy.js";
import { hasProjectedValueChange } from "../foundation/structured_value.js";

export function createSingleViewSessionBridge({
  state,
  getDocumentId,
  sessions = createViewSessionStore(),
  maxFocusedRoots = DEFAULT_FOCUSED_VIEW_POLICY.maximumRoots,
  onDispatch = null
}) {
  const bus = createCommandBus(createViewCommandHandlers({ sessions, maxFocusedRoots }), { onDispatch });

  function synchronizeSession() {
    const documentId = getDocumentId();
    const unitId = state.currentModule?.name;
    if (!documentId || !unitId) throw new Error("Legacy view command requires an open document and module");
    const value = {
      sessionId: "single:primary",
      documentId,
      domainId: "netlist",
      unitId,
      viewMode: state.viewMode,
      faninDepth: state.faninDepth,
      fanoutDepth: state.fanoutDepth,
      focusedRootRefs: rootsToRefs(state.focusedRootNodeIds, state.fullGraph, documentId, unitId, state.occurrenceContext?.occurrencePath),
      activeFocusedRootRef: focusedRootIdToRef(state.activeFocusedRootNodeId, state.fullGraph, documentId, unitId, state.occurrenceContext?.occurrencePath),
      selectedObjectRef: selectedToRef(state, documentId, unitId),
      viewport: state.transform,
      layoutPolicy: state.layoutPolicy,
      presentationPolicy: state.presentationPolicy,
      overrides: snapshotOverrides(state)
    };
    const current = sessions.get(value.sessionId);
    if (!current || current.documentId !== documentId || current.unitId !== unitId) {
      if (current) sessions.close(value.sessionId);
      return sessions.create(value);
    }
    return hasProjectedValueChange(current, value)
      ? sessions.update(value.sessionId, () => value, { invalidateComputation: false })
      : current;
  }

  return Object.freeze({
    sessions,
    dispatch(command) {
      const synchronized = synchronizeSession();
      const unitId = synchronized.unitId;
      const result = bus.dispatch({ ...command, sessionId: "single:primary" });
      const graph = result.session.unitId === unitId ? state.fullGraph : null;
      state.viewMode = result.session.viewMode;
      state.faninDepth = result.session.faninDepth;
      state.fanoutDepth = result.session.fanoutDepth;
      state.focusedRootNodeIds = refsToNodeIds(result.session.focusedRootRefs, graph);
      state.activeFocusedRootNodeId = refToNodeId(result.session.activeFocusedRootRef, graph);
      state.coneRootNodeId = state.focusedRootNodeIds[0] || null;
      state.selectedNodeId = result.session.selectedObjectRef?.kind === "net"
        ? null
        : refToNodeId(result.session.selectedObjectRef, graph);
      state.selectedNet = result.session.selectedObjectRef?.kind === "net"
        ? result.session.selectedObjectRef.localId
        : null;
      state.transform = { ...result.session.viewport };
      state.layoutPolicy = result.session.layoutPolicy;
      state.presentationPolicy = { ...result.session.presentationPolicy };
      applyOverridesSnapshot(state, result.session.overrides || {
        nodePositions: [], nodeSizes: [], graphOverrides: null
      });
      return result;
    },
    beginComputation() {
      const current = synchronizeSession();
      return sessions.update(current.sessionId, () => ({}));
    },
    objectRefForNode(node) {
      return nodeToRef(node, getDocumentId(), state.currentModule?.name);
    },
    objectRefForNet(netName) {
      return valueToRef("net", netName, getDocumentId(), state.currentModule?.name, state.occurrenceContext?.occurrencePath);
    },
    visibleObjectKeys() {
      const documentId = getDocumentId();
      const unitId = state.currentModule?.name;
      const nodeKeys = (state.graph?.nodes || []).map((node) => objectRefKey(nodeToRef(node, documentId, unitId)));
      const netKeys = [...new Set((state.graph?.edges || []).map((edge) => edge.net).filter(Boolean))]
        .map((net) => objectRefKey(valueToRef("net", net, documentId, unitId)));
      return [...nodeKeys, ...netKeys];
    }
  });
}

function snapshotOverrides(state) {
  return {
    nodePositions: new Map(state.nodePositions || []),
    nodeSizes: new Map(state.nodeSizes || []),
    graphOverrides: cloneGraphOverrides(state.graphOverrides)
  };
}

function applyOverridesSnapshot(state, snapshot) {
  if (!snapshot) return;
  state.nodePositions = new Map(snapshot.nodePositions || []);
  state.nodeSizes = new Map(snapshot.nodeSizes || []);
  state.graphOverrides = cloneGraphOverrides(snapshot.graphOverrides);
}

function cloneGraphOverrides(value) {
  return {
    nodeProperties: Object.fromEntries(Object.entries(value?.nodeProperties || {}).map(([id, properties]) => [id, { ...properties }])),
    cellPinDirections: Object.fromEntries(Object.entries(value?.cellPinDirections || {}).map(([id, pins]) => [id, { ...pins }]))
  };
}

function selectedToRef(state, documentId, unitId) {
  if (state.selectedNodeId) return nodeIdToRef(state.selectedNodeId, state.fullGraph, documentId, unitId);
  if (state.selectedNet) return valueToRef("net", state.selectedNet, documentId, unitId, state.occurrenceContext?.occurrencePath);
  return null;
}

function valueToRef(kind, localId, documentId, unitId, occurrencePath = null) {
  if (!kind || !localId || !documentId || !unitId) return null;
  return createObjectRef({ documentId, unitId, kind, localId, occurrencePath });
}

function rootsToRefs(nodeIds, graph, documentId, unitId, occurrencePath = null) {
  return (nodeIds || []).map((nodeId) => focusedRootIdToRef(nodeId, graph, documentId, unitId, occurrencePath)).filter(Boolean);
}

function focusedRootIdToRef(rootId, graph, documentId, unitId, occurrencePath = null) {
  if (typeof rootId === "string" && rootId.startsWith("net:")) {
    return valueToRef("net", rootId.slice(4), documentId, unitId, occurrencePath);
  }
  return nodeIdToRef(rootId, graph, documentId, unitId);
}

function nodeIdToRef(nodeId, graph, documentId, unitId) {
  if (!nodeId) return null;
  return nodeToRef(graph?.nodes?.find((node) => node.id === nodeId), documentId, unitId);
}

function nodeToRef(node, documentId, unitId) {
  if (!node || !documentId || !unitId) return null;
  return createObjectRef({
    documentId,
    unitId,
    kind: node.kind === "cell" ? "cell" : node.kind,
    localId: node.ref?.instance || node.ref?.name || node.id,
    occurrencePath: node.ref?.occurrencePath
  });
}

function refsToNodeIds(refs, graph) {
  return refs.map((ref) => refToNodeId(ref, graph)).filter(Boolean);
}

function refToNodeId(ref, graph) {
  if (!ref || !graph) return null;
  if (ref.kind === "net") return `net:${ref.localId}`;
  return graph.nodes.find((node) =>
    (node.ref?.instance || node.ref?.name || node.id) === ref.localId &&
    (node.kind === ref.kind || (ref.kind === "cell" && node.kind === "cell"))
  )?.id || null;
}
