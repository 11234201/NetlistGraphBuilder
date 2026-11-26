import { createObjectRef } from "../contracts/object_ref.js";

// Search uses the applied pair, never the uncommitted module picker values.
export function createWorkbenchSearchScope({ readContext, subscribe = () => {} }) {
  let previousKey, version = 0;
  function snapshot() {
    const context = readContext();
    const key = JSON.stringify([context.active, context.document?.documentId,
      context.document?.sourceRevision, context.modules.left, context.modules.right]);
    if (key !== previousKey) { previousKey = key; version++; }
    return { ...context, version };
  }
  subscribe((next, previous) => {
    if ((!next || !previous) && (next || previous)?.sessionId?.startsWith("compare:")) version++;
    snapshot();
  });
  function scopeSearchIndex(index) {
    const context = snapshot();
    if (!context.active) return index;
    return (index || []).flatMap((entry) => {
      const side = ["left", "right"].find((value) => context.modules[value] === entry.moduleName);
      if (!side) return [];
      const target = entry.target;
      return [{ ...entry, side, searchScope: context.version,
        objectRef: entry.objectRef || createObjectRef({ documentId: context.document.documentId,
          unitId: entry.moduleName, kind: target.kind, localId: target.name }) }];
    });
  }
  function accepts(result, context = snapshot()) {
    return Boolean(context.active && result?.searchScope === context.version &&
      ["left", "right"].includes(result.side) && context.modules[result.side] === result.moduleName &&
      result.objectRef?.documentId === context.document?.documentId &&
      result.objectRef?.unitId === result.moduleName && result.objectRef?.localId === result.target?.name);
  }
  return Object.freeze({ snapshot, accepts, scopeSearchIndex,
    readSearchGraph(moduleName) {
      const context = snapshot();
      return context.active
        ? ["left", "right"].map((side) => context.graphs[side]).find((graph) => graph?.moduleName === moduleName)
        : context.singleGraph?.moduleName === moduleName ? context.singleGraph : null;
    }
  });
}
