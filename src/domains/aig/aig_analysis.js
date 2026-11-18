export function analyzeAig(model) {
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const incoming = Object.fromEntries(model.nodes.map((node) => [node.id, []]));
  const outgoing = Object.fromEntries(model.nodes.map((node) => [node.id, []]));
  const edgeById = new Map(model.edges.map((edge) => [edge.id, edge]));
  for (const edge of model.edges) { incoming[edge.target].push(edge.id); outgoing[edge.source].push(edge.id); }
  const outputs = model.nodes.filter((node) => node.kind === "po");
  const depth = outputs.reduce((maximum, node) => Math.max(maximum, node.level), 0);
  const remaining = new Map(outputs.map((node) => [node.id, 0]));
  const reverse = [...model.nodes].filter((node) => node.kind !== "po").sort((first, second) => second.level - first.level);
  for (const node of reverse) {
    let best = -1;
    for (const edgeId of outgoing[node.id]) {
      const target = edgeById.get(edgeId).target;
      if (remaining.has(target)) best = Math.max(best, remaining.get(target) + Number(byId.get(target).kind === "and"));
    }
    if (best >= 0) remaining.set(node.id, best);
  }
  const criticalNodes = model.nodes.filter((node) => remaining.has(node.id) && node.level + remaining.get(node.id) === depth).map((node) => node.id);
  const criticalEdges = model.edges.filter((edge) => remaining.has(edge.target) && byId.get(edge.source).level + Number(byId.get(edge.target).kind === "and") + remaining.get(edge.target) === depth).map((edge) => edge.id);
  const counts = { pi: 0, and: 0, po: 0, constant: 0, edges: model.edges.length, invertedEdges: model.edges.filter((edge) => edge.inverted).length };
  for (const node of model.nodes) counts[node.kind] = (counts[node.kind] || 0) + 1;
  return { depth, fanout: Object.fromEntries(model.nodes.map((node) => [node.id, outgoing[node.id].length])), criticalNodes, criticalEdges, incoming, outgoing, counts };
}
