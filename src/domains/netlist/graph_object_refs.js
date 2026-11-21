import { createObjectRef } from "../../contracts/object_ref.js";

export function graphNodeToObjectRef(node, { documentId, unitId }) {
  if (!node || !documentId || !unitId) return null;
  return createObjectRef({
    documentId,
    unitId,
    kind: node.kind,
    localId: node.ref?.instance || node.ref?.name || node.ref?.localId || node.id,
    occurrencePath: node.ref?.occurrencePath
  });
}

export function objectRefToNodeId(ref, graph) {
  // A canonical net root is available while the destination occurrence's
  // first graph is still being prepared.
  if (ref?.kind === "net") return `net:${ref.localId}`;
  if (!ref || !graph) return null;
  return graph.nodes.find((node) =>
    (node.ref?.instance || node.ref?.name || node.ref?.localId || node.id) === ref.localId &&
    node.kind === ref.kind &&
    occurrenceMatches(node.ref?.occurrencePath, ref.occurrencePath)
  )?.id || null;
}

// An absent occurrence retains the legacy module-definition lookup semantics.
export function occurrenceMatches(nodePath, refPath) {
  if (!Array.isArray(refPath) || refPath.length === 0) return true;
  return Array.isArray(nodePath) && nodePath.length === refPath.length &&
    nodePath.every((segment, index) => segment === refPath[index]);
}
