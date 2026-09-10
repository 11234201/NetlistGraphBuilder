import { createViewSessionStore } from "../application/view_session_store.js";
import { createObjectRef } from "../contracts/object_ref.js";

export function createLegacyCompareSessionAdapter({ state, getDocumentId }) {
  const sessions = createViewSessionStore();
  const sessionIdFor = (side) => `compare:${side}`;

  function ensure(side) {
    const sessionId = sessionIdFor(side);
    const unitId = side === "left" ? state.compare.leftModuleName : state.compare.rightModuleName;
    const documentId = getDocumentId();
    const current = sessions.get(sessionId);
    if (current && current.documentId === documentId && current.unitId === unitId) return current;
    if (current) sessions.close(sessionId);
    return sessions.create({ sessionId, documentId, domainId: "netlist", unitId });
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

  return Object.freeze({ sessions, ensure, replaceRoots });
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
