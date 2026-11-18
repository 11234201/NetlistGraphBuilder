import { createOrderedStructureIndex, compareStructureId } from "../../analysis/structure_index.js";
export { compareStructureId };

export function createStructureIndex(model) {
  return createOrderedStructureIndex(model, (a, b) => Number(a.kind === "po") - Number(b.kind === "po"),
    (node) => node.kind === "and");
}

// A cut boundary stops traversal everywhere, including shared/repeated fanins.
export function collectCut(index, rootId, leaves, maximum, budget) {
  const boundary = new Set(leaves), members = new Set(), edgeIds = new Set(), pending = [rootId];
  while (pending.length) {
    if (!budget.spend()) return null;
    const id = pending.pop(), node = index.byId.get(id);
    if (boundary.has(id) || node.kind === "constant" || members.has(id)) continue;
    if (node.kind !== "and" || index.incoming.get(id).length !== 2) return null;
    if (members.size === maximum) { budget.limit("block-node-limit"); return null; }
    members.add(id);
    for (const edge of index.incoming.get(id)) { edgeIds.add(edge.id); pending.push(edge.source); }
  }
  return { nodeIds: [...members].sort((a, b) => index.rank.get(a) - index.rank.get(b)), edgeIds: [...edgeIds].sort(compareStructureId) };
}
