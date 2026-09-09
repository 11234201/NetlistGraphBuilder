import { createCommandBus } from "../application/command_bus.js";
import { createViewCommandHandlers } from "../application/view_commands.js";
import { createViewSessionStore } from "../application/view_session_store.js";
import { createObjectRef, objectRefKey } from "../contracts/object_ref.js";

export function createLegacyViewCommandAdapter({ state, getDocumentId, maxFocusedRoots = 8 }) {
  return Object.freeze({
    dispatch(command) {
      const documentId = getDocumentId();
      const unitId = state.currentModule?.name;
      if (!documentId || !unitId) throw new Error("Legacy view command requires an open document and module");
      const sessions = createViewSessionStore([{
        sessionId: "legacy:single",
        documentId,
        domainId: "netlist",
        unitId,
        viewMode: state.viewMode,
        focusedRootRefs: rootsToRefs(state.focusedRootNodeIds, state.fullGraph, documentId, unitId),
        activeFocusedRootRef: nodeIdToRef(state.activeFocusedRootNodeId, state.fullGraph, documentId, unitId)
      }]);
      const bus = createCommandBus(createViewCommandHandlers({ sessions, maxFocusedRoots }));
      const result = bus.dispatch({ ...command, sessionId: "legacy:single" });
      const graph = result.session.unitId === unitId ? state.fullGraph : null;
      state.viewMode = result.session.viewMode;
      state.focusedRootNodeIds = refsToNodeIds(result.session.focusedRootRefs, graph);
      state.activeFocusedRootNodeId = refToNodeId(result.session.activeFocusedRootRef, graph);
      state.coneRootNodeId = state.focusedRootNodeIds[0] || null;
      return result;
    },
    objectRefForNode(node) {
      return nodeToRef(node, getDocumentId(), state.currentModule?.name);
    },
    visibleObjectKeys() {
      const documentId = getDocumentId();
      const unitId = state.currentModule?.name;
      return (state.graph?.nodes || []).map((node) => objectRefKey(nodeToRef(node, documentId, unitId)));
    }
  });
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
