import { createCommandBus } from "../application/command_bus.js";
import { createViewCommandHandlers } from "../application/view_commands.js";
import { createViewSessionStore } from "../application/view_session_store.js";
import { createObjectRef, objectRefKey } from "../contracts/object_ref.js";

export function createLegacyViewCommandAdapter({ state, getDocumentId, maxFocusedRoots = 8 }) {
  const sessions = createViewSessionStore();
  const bus = createCommandBus(createViewCommandHandlers({ sessions, maxFocusedRoots }));

  function synchronizeSession() {
    const documentId = getDocumentId();
    const unitId = state.currentModule?.name;
    if (!documentId || !unitId) throw new Error("Legacy view command requires an open document and module");
    const value = {
      sessionId: "legacy:single",
      documentId,
      domainId: "netlist",
      unitId,
      viewMode: state.viewMode,
      focusedRootRefs: rootsToRefs(state.focusedRootNodeIds, state.fullGraph, documentId, unitId),
      activeFocusedRootRef: nodeIdToRef(state.activeFocusedRootNodeId, state.fullGraph, documentId, unitId),
      selectedObjectRef: selectedToRef(state, documentId, unitId),
      viewport: state.transform,
      layoutPolicy: state.layoutPolicy
    };
    const current = sessions.get(value.sessionId);
    if (!current || current.documentId !== documentId || current.unitId !== unitId) {
      if (current) sessions.close(value.sessionId);
      return sessions.create(value);
    }
    return sessions.update(value.sessionId, () => value, { invalidateComputation: false });
  }

  return Object.freeze({
    sessions,
    dispatch(command) {
      const synchronized = synchronizeSession();
      const unitId = synchronized.unitId;
      const result = bus.dispatch({ ...command, sessionId: "legacy:single" });
      const graph = result.session.unitId === unitId ? state.fullGraph : null;
      state.viewMode = result.session.viewMode;
      state.focusedRootNodeIds = refsToNodeIds(result.session.focusedRootRefs, graph);
      state.activeFocusedRootNodeId = refToNodeId(result.session.activeFocusedRootRef, graph);
      state.coneRootNodeId = state.focusedRootNodeIds[0] || null;
      state.selectedNodeId = refToNodeId(result.session.selectedObjectRef, graph);
      state.selectedNet = result.session.selectedObjectRef?.kind === "net"
        ? result.session.selectedObjectRef.localId
        : null;
      state.transform = { ...result.session.viewport };
      state.layoutPolicy = result.session.layoutPolicy;
      return result;
    },
    objectRefForNode(node) {
      return nodeToRef(node, getDocumentId(), state.currentModule?.name);
    },
    objectRefForNet(netName) {
      return valueToRef("net", netName, getDocumentId(), state.currentModule?.name);
    },
    visibleObjectKeys() {
      const documentId = getDocumentId();
      const unitId = state.currentModule?.name;
      return (state.graph?.nodes || []).map((node) => objectRefKey(nodeToRef(node, documentId, unitId)));
    }
  });
}

function selectedToRef(state, documentId, unitId) {
  if (state.selectedNodeId) return nodeIdToRef(state.selectedNodeId, state.fullGraph, documentId, unitId);
  if (state.selectedNet) return valueToRef("net", state.selectedNet, documentId, unitId);
  return null;
}

function valueToRef(kind, localId, documentId, unitId) {
  if (!kind || !localId || !documentId || !unitId) return null;
  return createObjectRef({ documentId, unitId, kind, localId });
}

function rootsToRefs(nodeIds, graph, documentId, unitId) {
  return (nodeIds || []).map((nodeId) => nodeIdToRef(nodeId, graph, documentId, unitId)).filter(Boolean);
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
    localId: node.ref?.instance || node.ref?.name || node.id
  });
}

function refsToNodeIds(refs, graph) {
  return refs.map((ref) => refToNodeId(ref, graph)).filter(Boolean);
}

function refToNodeId(ref, graph) {
  if (!ref || !graph) return null;
  return graph.nodes.find((node) =>
    (node.ref?.instance || node.ref?.name || node.id) === ref.localId &&
    (node.kind === ref.kind || (ref.kind === "cell" && node.kind === "cell"))
  )?.id || null;
}
