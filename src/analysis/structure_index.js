export function compareStructureId(first, second) { return first < second ? -1 : first > second ? 1 : 0; }

export function createOrderedStructureIndex(model, tieBreak = () => 0, isBranchTarget = () => true) {
  const nodes = [...model.nodes].sort((a, b) => a.level - b.level || tieBreak(a, b) || compareStructureId(a.id, b.id));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const rank = new Map(nodes.map((node, index) => [node.id, index]));
  const incoming = new Map(nodes.map((node) => [node.id, []]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  const edges = [...model.edges].sort((a, b) => compareStructureId(a.target, b.target) || compareStructureId(a.source, b.source) || Number(a.inverted) - Number(b.inverted) || compareStructureId(a.id, b.id));
  for (const edge of edges) { incoming.get(edge.target).push(edge); outgoing.get(edge.source).push(edge); }
  // Compute distinct eligible branch targets once per topology. Reachability
  // searches still charge every traversed connection against their budget.
  const branchSources = new Set();
  for (const [id, fanouts] of outgoing) {
    if (fanouts.length < 2) continue;
    let first = null;
    for (const edge of fanouts) {
      if (!isBranchTarget(byId.get(edge.target))) continue;
      if (first !== null && first !== edge.target) { branchSources.add(id); break; }
      first = edge.target;
    }
  }
  return { nodes, byId, rank, incoming, outgoing, branchSources, edges, edgeById: new Map(edges.map((edge) => [edge.id, edge])) };
}
