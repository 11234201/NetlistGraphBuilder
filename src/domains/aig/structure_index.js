export function compareStructureId(first, second) { return first < second ? -1 : first > second ? 1 : 0; }

export function createStructureIndex(model) {
  const nodes = [...model.nodes].sort((a, b) => a.level - b.level || Number(a.kind === "po") - Number(b.kind === "po") || compareStructureId(a.id, b.id));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const rank = new Map(nodes.map((node, index) => [node.id, index]));
  const incoming = new Map(nodes.map((node) => [node.id, []]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  const edges = [...model.edges].sort((a, b) => compareStructureId(a.target, b.target) || compareStructureId(a.source, b.source) || Number(a.inverted) - Number(b.inverted) || compareStructureId(a.id, b.id));
  for (const edge of edges) { incoming.get(edge.target).push(edge); outgoing.get(edge.source).push(edge); }
  return { nodes, byId, rank, incoming, outgoing, edges, edgeById: new Map(edges.map((edge) => [edge.id, edge])) };
}

// A cut boundary stops traversal everywhere, including shared/repeated fanins.
export function collectCut(index, rootId, leaves, maximum, budget) {
  const boundary = new Set(leaves), members = new Set(), edgeIds = new Set(), pending = [rootId];
  while (pending.length) {
    if (!budget.spend()) return null;
    const id = pending.pop(), node = index.byId.get(id);
    if (boundary.has(id) || node.kind === "constant" || members.has(id)) continue;
    if (node.kind !== "and") return null;
    if (members.size === maximum) { budget.limit("block-node-limit"); return null; }
    members.add(id);
    for (const edge of index.incoming.get(id)) { edgeIds.add(edge.id); pending.push(edge.source); }
  }
  return { nodeIds: [...members].sort((a, b) => index.rank.get(a) - index.rank.get(b)), edgeIds: [...edgeIds].sort(compareStructureId) };
}
