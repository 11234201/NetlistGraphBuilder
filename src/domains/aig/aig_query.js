const queryCache = new WeakMap();

export function createAigQuery(model, analysis) {
  const existing = queryCache.get(model);
  if (existing?.analysis === analysis) return existing.query;
  const nodeById = new Map(model.nodes.map((node) => [node.id, node]));
  const edgeById = new Map(model.edges.map((edge) => [edge.id, edge]));
  const incomingEdges = (id) => (analysis.incoming[id] || []).map((edgeId) => edgeById.get(edgeId));
  const outgoingEdges = (id) => (analysis.outgoing[id] || []).map((edgeId) => edgeById.get(edgeId));
  const query = Object.freeze({
    nodeById, edgeById,
    criticalNodes: new Set(analysis.criticalNodes),
    criticalEdges: new Set(analysis.criticalEdges),
    getObject(id) { return nodeById.get(id) || edgeById.get(id) || null; },
    incomingEdges, outgoingEdges,
    connections(id) { return { incoming: incomingEdges(id), outgoing: outgoingEdges(id) }; }
  });
  queryCache.set(model, { analysis, query });
  return query;
}

export function getAigObject(model, id) {
  let cached = queryCache.get(model);
  if (!cached) {
    cached = { objects: new Map([...model.nodes, ...model.edges].map((object) => [object.id, object])) };
    queryCache.set(model, cached);
  }
  return cached.query?.getObject(id) || cached.objects?.get(id) || null;
}

export function buildAigSearchIndex(model) {
  return Object.freeze(model.nodes.map((node) => Object.freeze({
    id: node.id, kind: node.kind, label: node.label,
    sourceIds: Object.freeze(node.sourceRefs.map((ref) => ref.id)),
    text: [node.id, node.label, ...node.sourceRefs.flatMap((ref) => [ref.id, ref.label])].join("\n").toLowerCase()
  })));
}

export function searchAigIndex(index, query = "", limit = 100) {
  const words = String(query).trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = [];
  const count = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : index.length;
  for (const entry of index) {
    if (matches.length >= count) break;
    if (words.every((word) => entry.text.includes(word))) matches.push(entry);
  }
  return matches;
}
