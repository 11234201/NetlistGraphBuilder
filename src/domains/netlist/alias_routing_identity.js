// Folded assigns retain their logical names for inspection, but share one
// routing identity. Only the active view projection receives this metadata.
export function projectAliasRoutingIdentity(graph, fullGraph = graph) {
  if (!graph.aliases?.length) return graph;
  const constants = new Set(fullGraph.nodes.filter((node) => node.kind === "constant").map((node) => node.ref?.name));
  const neighbors = new Map();
  for (const { lhs, rhs } of graph.aliases) {
    if (typeof lhs !== "string" || typeof rhs !== "string" || constants.has(lhs) || constants.has(rhs)) continue;
    if (!neighbors.has(lhs)) neighbors.set(lhs, []);
    if (!neighbors.has(rhs)) neighbors.set(rhs, []);
    neighbors.get(lhs).push(rhs);
    neighbors.get(rhs).push(lhs);
  }
  const identities = new Map();
  for (const name of neighbors.keys()) {
    if (identities.has(name)) continue;
    const members = [name];
    identities.set(name, name);
    let canonical = name;
    for (let index = 0; index < members.length; index++) {
      for (const next of neighbors.get(members[index])) {
        if (identities.has(next)) continue;
        identities.set(next, name);
        members.push(next);
        if (next < canonical) canonical = next;
      }
    }
    for (const member of members) identities.set(member, canonical);
  }
  return { ...graph, edges: graph.edges.map((edge) => identities.has(edge.net)
    ? { ...edge, routingNet: identities.get(edge.net) } : edge) };
}
