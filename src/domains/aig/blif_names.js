const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const WARNING_SAMPLE_LIMIT = 8;

// Bind against source names *after* canonical numbering. BLIF aliases can share
// a driver with opposite polarity, and an output port is a distinct usage.
export function bindBlifNames(model, candidates) {
  if (!candidates?.length) return model;
  const signals = new Map(model.provenance.map((ref) => [ref.id, ref]));
  const outputs = new Map(model.nodes.filter((node) => node.kind === "po").map((node) => [node.label, node.id]));
  const groups = new Map();
  for (const mapping of candidates) {
    if (!signals.has(mapping.signalId) && !/^n\d+$/i.test(mapping.signalId)) continue;
    let names = groups.get(mapping.signalId);
    if (!names) groups.set(mapping.signalId, names = new Map());
    if (!names.has(mapping.name)) names.set(mapping.name, mapping);
  }
  if (!groups.size) return model;
  const warnings = { conflictCount: 0, unknownCount: 0, samples: [] };
  const nameMappings = [];
  const byNode = new Map();
  function bind(mapping, nodeId, inverted, usage, conflict) {
    const row = { ...mapping, nodeId, inverted, usage, conflict };
    nameMappings.push(row);
    if (!nodeId) return;
    let rows = byNode.get(nodeId);
    if (!rows) byNode.set(nodeId, rows = []);
    rows.push(row);
  }
  for (const signalId of [...groups.keys()].sort(compare)) {
    const ref = signals.get(signalId);
    const names = [...groups.get(signalId).values()].sort((a, b) => compare(a.name, b.name));
    const conflict = names.length > 1;
    if (conflict) warnings.conflictCount++;
    if (!ref) warnings.unknownCount++;
    if ((conflict || !ref) && warnings.samples.length < WARNING_SAMPLE_LIMIT) {
      warnings.samples.push({ signalId, line: names[0].line, reason: !ref ? "unknown-signal" : "conflicting-names" });
    }
    for (const mapping of names) {
      bind(mapping, ref?.nodeId ?? null, Boolean(ref?.inverted), ref ? "driver" : "unknown", conflict);
      if (outputs.has(signalId)) bind(mapping, outputs.get(signalId), false, "output", conflict);
    }
  }
  const nodes = model.nodes.map((node) => {
    const rows = byNode.get(node.id);
    if (!rows) return node;
    const definingId = node.sourceRefs.find((ref) => !ref.alias)?.id;
    const primaryNameMapping = rows.find((row) => row.signalId === definingId && !row.conflict);
    const names = primaryNameMapping && primaryNameMapping !== rows[0]
      ? [primaryNameMapping, ...rows.filter((row) => row !== primaryNameMapping)] : rows;
    return { ...node, nameMappings: names, ...(primaryNameMapping ? { primaryNameMapping } : {}) };
  });
  return { ...model, nodes, nameMappings,
    ...(warnings.conflictCount || warnings.unknownCount ? { mappingWarnings: warnings } : {}) };
}
