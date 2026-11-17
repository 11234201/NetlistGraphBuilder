export const AIG_NEIGHBOR_COLORS = Object.freeze({ input: "#2563eb", output: "#16a34a", both: "#9333ea" });

// Visit indexed incident edges only; selection never scans or alters the graph.
export function aigSelectionHighlights(query, selectedId, policy) {
  const roles = new Map();
  if (!policy.neighbors || !selectedId) return roles;
  const add = (id, role) => roles.set(id, roles.has(id) && roles.get(id) !== role ? "both" : role);
  if (query.nodeById.has(selectedId)) {
    const { incoming, outgoing } = query.connections(selectedId);
    for (const edge of incoming) { add(edge.id, "input"); add(edge.source, "input"); }
    for (const edge of outgoing) { add(edge.id, "output"); add(edge.target, "output"); }
  } else {
    const edge = query.edgeById.get(selectedId);
    if (edge) { add(edge.source, "input"); add(edge.target, "output"); }
  }
  return roles;
}
