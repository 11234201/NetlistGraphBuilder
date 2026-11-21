import { createObjectRef } from "../contracts/object_ref.js";
import { graphNodeToObjectRef, objectRefToNodeId, occurrenceMatches } from "../domains/netlist/graph_object_refs.js";
import { immutableSnapshot } from "../foundation/immutable_snapshot.js";
import { normalizeViewQuery } from "../contracts/view_query.js";
import { normalizeViewMode } from "../foundation/view_policy.js";

export function importViewQuery(value, current) {
  return normalizeViewQuery({ ...value,
    ...(value.viewMode !== undefined ? { viewMode: normalizeViewMode(value.viewMode) } : {})
  }, current);
}

export const SINGLE_NAVIGATION_FIELDS = Object.freeze([
  "focusedRootRefs", "focusedRootNodeIds", "activeFocusedRootNodeId", "coneRootNodeId", "selectedNodeId", "selectedNet",
  "showPath", "viewMode", "coneDepth", "faninDepth", "fanoutDepth"
]);
export const COMPARE_NAVIGATION_FIELDS = Object.freeze([
  "showPath", "focusedRootRefs", "focusedRootNodeIds", "activeFocusedRootNodeId", "selectedKind", "selectedName", "selectedSide", "selectedObjectRefs"
]);

// Old archives can contain graph IDs without canonical refs. Keep that explicit
// import intent until its destination graph exists; never reconstruct it from
// mutable UI projections during an ordinary command.
export function snapshotNavigationImport(value = {}) {
  return immutableSnapshot({
    focusedRootNodeIds: value.focusedRootNodeIds || (value.coneRootNodeId ? [value.coneRootNodeId] : []),
    focusedRootRefs: value.focusedRootRefs || [],
    activeFocusedRootNodeId: value.activeFocusedRootNodeId || null,
    selectedNodeId: value.selectedNodeId || null,
    selectedNet: value.selectedNet || null,
    selectedObjectRef: value.selectedObjectRef || null
  });
}

export function resolveNavigationImport(value, context, graph) {
  const candidates = value.focusedRootRefs.filter((ref) =>
    ref.documentId === context.documentId && ref.unitId === context.unitId &&
    occurrenceMatches(ref.occurrencePath, context.occurrencePath));
  const refForId = (id) => {
    if (typeof id !== "string") return null;
    if (id.startsWith("net:")) {
      const name = id.slice(4);
      const node = graph?.nodes?.find((item) => (item.kind === "net" || item.kind === "hub") &&
        (item.ref?.localId || item.ref?.name || item.label) === name &&
        occurrenceMatches(item.ref?.occurrencePath, context.occurrencePath));
      return createObjectRef({ ...context, kind: "net", localId: name,
        occurrencePath: node?.ref?.occurrencePath || context.occurrencePath });
    }
    const node = graph?.nodes?.find((item) => item.id === id);
    return node ? graphNodeToObjectRef(node, context) : null;
  };
  const refs = value.focusedRootNodeIds.map((id, index) => {
    const candidate = candidates[index];
    if (candidate && (!graph || objectRefToNodeId(candidate, graph) === id)) return candidate;
    return refForId(id);
  }).filter(Boolean);
  const activeIndex = value.focusedRootNodeIds.indexOf(value.activeFocusedRootNodeId);
  const active = refs.find((ref) => objectRefToNodeId(ref, graph) === value.activeFocusedRootNodeId)
    || (!graph ? refs[activeIndex] : null) || refs[0] || null;
  const selected = value.selectedObjectRef;
  return {
    focusedRootRefs: refs,
    activeFocusedRootRef: active,
    selectedObjectRef: selected?.documentId === context.documentId && selected.unitId === context.unitId
      ? selected : value.selectedNet
        ? refForId(`net:${value.selectedNet}`)
        : refForId(value.selectedNodeId)
  };
}

export function projectNavigation(session, graph, pending = null) {
  const rootIds = pending ? pending.focusedRootNodeIds
    : session.focusedRootRefs.map((ref) => objectRefToNodeId(ref, graph)).filter(Boolean);
  return {
    focusedRootRefs: Object.freeze([...session.focusedRootRefs]),
    focusedRootNodeIds: Object.freeze([...rootIds]),
    activeFocusedRootNodeId: pending ? pending.activeFocusedRootNodeId || rootIds[0] || null
      : objectRefToNodeId(session.activeFocusedRootRef, graph),
    coneRootNodeId: rootIds[0] || null,
    selectedNodeId: pending ? pending.selectedNodeId
      : session.selectedObjectRef?.kind === "net" ? null : objectRefToNodeId(session.selectedObjectRef, graph),
    selectedNet: pending ? pending.selectedNet
      : session.selectedObjectRef?.kind === "net" ? session.selectedObjectRef.localId : null
  };
}

export function navigationGraph(graph, unitId, occurrencePath) {
  if (!graph || (graph.moduleName && graph.moduleName !== unitId)) return null;
  if (Array.isArray(occurrencePath) && graph.nodes?.some((node) => node.ref) &&
      !graph.nodes.some((node) => {
        const path = node.ref?.occurrencePath || [];
        return path.length === occurrencePath.length && path.every((part, index) => part === occurrencePath[index]);
      })) return null;
  return graph;
}
