export const AIG_NEIGHBOR_COLORS = Object.freeze({ input: "#2563eb", output: "#16a34a", both: "#9333ea" });

function supportsConeTrace(node) {
  return node?.kind === "pi" || node?.kind === "po" || node?.kind === "and";
}

export function describeAigSelection(query, selectedId, policy) {
  return {
    roles: aigSelectionHighlights(query, selectedId, policy),
    dimOutside: policy.connectionHighlight !== "off" && supportsConeTrace(query.nodeById.get(selectedId))
  };
}

// Keep each direction separate so shared drivers and loads cannot lead into sibling branches.
function traceCone(query, selectedId, role, limit, add) {
  const upstream = role === "input";
  const edgesFrom = upstream ? query.incomingEdges : query.outgoingEdges;
  const pending = [selectedId];
  const visited = new Set(pending);
  let head = 0;
  for (let level = 0; head < pending.length && level < limit; level++) {
    const end = pending.length;
    while (head < end) {
      for (const edge of edgesFrom(pending[head++])) {
        const nextId = upstream ? edge.source : edge.target;
        add(edge.id, role);
        add(nextId, role);
        if (visited.has(nextId)) continue;
        visited.add(nextId);
        if (query.nodeById.get(nextId)?.kind === "and") pending.push(nextId);
      }
    }
  }
}

export function aigSelectionHighlights(query, selectedId, policy) {
  const roles = new Map();
  if (policy.connectionHighlight === "off" || !selectedId) return roles;
  const add = (id, role) => roles.set(id, roles.has(id) && roles.get(id) !== role ? "both" : role);
  const node = query.nodeById.get(selectedId);
  if (supportsConeTrace(node)) {
    const limit = typeof policy.connectionHighlight === "number" ? policy.connectionHighlight : Infinity;
    if (node.kind !== "pi") traceCone(query, selectedId, "input", limit, add);
    if (node.kind !== "po") traceCone(query, selectedId, "output", limit, add);
  } else if (node) {
    const { incoming, outgoing } = query.connections(selectedId);
    for (const edge of incoming) { add(edge.id, "input"); add(edge.source, "input"); }
    for (const edge of outgoing) { add(edge.id, "output"); add(edge.target, "output"); }
  } else {
    const edge = query.edgeById.get(selectedId);
    if (edge) { add(edge.source, "input"); add(edge.target, "output"); }
  }
  return roles;
}
