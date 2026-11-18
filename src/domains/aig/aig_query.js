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
    id: node.id, kind: node.kind, label: node.label, canFocus: true,
    sourceIds: Object.freeze(node.sourceRefs.map((ref) => ref.id)),
    sourceRefs: node.sourceRefs, nameMappings: node.nameMappings, primaryNameMapping: node.primaryNameMapping,
    text: ["", node.id, node.label, ...node.sourceRefs.flatMap((ref) => [ref.id, ref.label]),
      ...(node.nameMappings || []).map((row) => row.name), ""].join("\n").toLowerCase()
  })));
}

export function searchAigIndex(index, query = "", limit = 100) {
  const term = String(query).trim().toLowerCase();
  const count = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : index.length;
  if (!count) return [];
  if (!term) return index.slice(0, count).map((entry) => describeBindings(entry, entry.primaryNameMapping ? [entry.primaryNameMapping] : []));
  const words = term.split(/\s+/);
  const ports = [], exact = [], partial = [];
  const field = "\n" + term + "\n";
  for (const entry of index) {
    if (entry.text.includes(field)) {
      const namedPort = (entry.kind === "pi" || entry.kind === "po") &&
        (entry.label.toLowerCase() === term || entry.primaryNameMapping?.name.toLowerCase() === term || entry.sourceRefs.some((ref) =>
          !ref.alias && (ref.id.toLowerCase() === term || ref.label?.toLowerCase() === term)));
      if (namedPort) {
        ports.push(entry);
        if (ports.length === count) break;
      } else if (exact.length < count) exact.push(entry);
    } else if (partial.length < count && words.every((word) => entry.text.includes(word))) partial.push(entry);
  }
  const matches = ports.concat(exact.slice(0, count - ports.length));
  return matches.concat(partial.slice(0, count - matches.length)).map((entry) => describeHit(entry, term, words));
}

function describeHit(entry, term, words) {
  const mappings = entry.nameMappings || [];
  const exact = (text) => typeof text === "string" && text.toLowerCase() === term;
  const contains = (text) => words.every((word) => text.toLowerCase().includes(word));
  const matches = mappings.filter((row) => exact(row.signalId) || exact(row.name));
  const sources = entry.sourceRefs.filter((ref) => exact(ref.id) || exact(ref.label));
  if (sources.length) {
    const mappedIds = new Set(matches.map((row) => row.signalId));
    for (const ref of sources) if (!mappedIds.has(ref.id)) matches.push(ref);
  }
  if (matches.length) return describeBindings(entry, matches);
  if (exact(entry.id) || exact(entry.label)) return describeBindings(entry, entry.primaryNameMapping ? [entry.primaryNameMapping] : []);
  const mapping = mappings.find((row) => contains(`${row.signalId} ${row.name}`));
  const ref = mapping || entry.sourceRefs.find((ref) => contains(`${ref.id} ${ref.label}`));
  return describeBindings(entry, ref ? [ref] : []);
}

// Different source names, including inverted aliases, may designate one
// canonical node. Keep that node selectable once and identify matching uses.
function describeBindings(entry, bindings) {
  if (!bindings.length) return entry;
  const first = bindings[0];
  const origins = bindings.slice(0, 3).map((ref) => (ref.signalId || ref.id) +
    (ref.inverted ? " (inverted)" : "") + (ref.conflict ? ` / ${ref.name} (conflicting names)` : ""));
  if (bindings.length > origins.length) origins.push(`+${bindings.length - origins.length} more`);
  return { ...entry, bindings, label: first.name || first.label || first.id, detail: `${origins.join(", ")} → ${entry.id}` };
}
