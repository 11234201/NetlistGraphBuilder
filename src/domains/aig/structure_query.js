const cache = new WeakMap();
export const AIG_BLOCK_NAMES = Object.freeze({ xor: "XOR2", xnor: "XNOR2", mux: "MUX2" });

export function createStructureQuery(data) {
  if (!data) return null;
  if (cache.has(data)) return cache.get(data);
  const results = [...data.blocks.results, ...data.reconvergence.results], byId = new Map(results.map((result) => [result.id, result]));
  const membership = new Map(), roots = new Map(), types = new Map();
  for (const result of results) {
    const nodes = result.category === "block" ? [...result.nodeIds, ...result.boundaryIds] : result.paths.flatMap((path) => path.nodeIds);
    for (const id of new Set(nodes)) { if (!membership.has(id)) membership.set(id, new Set()); membership.get(id).add(result.id); }
    if (result.category !== "block") continue;
    if (!roots.has(result.rootId)) roots.set(result.rootId, []);
    roots.get(result.rootId).push(result);
    if (!types.has(result.kind)) types.set(result.kind, []);
    types.get(result.kind).push(result);
  }
  // Retain only the inspected cut. Overlapping cuts can share large fanouts.
  let lastUses = null;
  const query = Object.freeze({
    formula: structureFormula, functionAtUse: structureFunctionAtUse, typeNames: AIG_BLOCK_NAMES,
    blockUses(block, outgoing, visibleEdges) {
      if (lastUses?.block === block && lastUses.outgoing === outgoing && lastUses.visibleEdges === visibleEdges) return lastUses.uses;
      const realOutputs = (id) => {
        const edges = outgoing[id] || [];
        return visibleEdges ? edges.filter((edge) => visibleEdges.has(edge)) : edges;
      };
      const inside = new Set(block.edgeIds), taps = [];
      for (const id of block.nodeIds) {
        if (id === block.rootId) continue;
        for (const edgeId of realOutputs(id)) {
          if (!inside.has(edgeId)) taps.push(edgeId);
        }
      }
      const uses = { rootEdges: realOutputs(block.rootId), taps };
      lastUses = { block, outgoing, visibleEdges, uses };
      return uses;
    },
    get: (id) => byId.get(id) || null,
    list(category = "reconvergence", type = "all") { return category === "block" ? type === "all" ? data.blocks.results : types.get(type) || [] : data.reconvergence.results; },
    rootEntries: () => roots.entries(), uniqueRoots: roots.size,
    relatedTo(subject, category, detail = null) {
      let nodes;
      if (subject.category === "block") {
        nodes = category === "block" ? [subject.rootId] : [...subject.nodeIds,...subject.boundaryIds];
      } else if (subject.category === "reconvergence") {
        nodes = detail?.nodeIds || subject.paths.flatMap(path => path.nodeIds);
      } else {
        nodes = subject.source && subject.target ? [subject.source,subject.target] : [subject.id];
      }
      return query.related(nodes,category,subject.category ? subject.id : null);
    },
    related(nodeIds, category, excludeId = null) {
      const ids = new Set();
      for (const nodeId of nodeIds) for (const id of membership.get(nodeId) || []) if (id !== excludeId && byId.get(id).category === category) ids.add(id);
      return [...ids].sort().map((id) => byId.get(id));
    }
  });
  cache.set(data, query); return query;
}

// A complemented MUX flips both data literals and leaves the selector alone.
// Only the receiving edge determines which phase of the positive root is used.
export function structureFunctionAtUse(result, inverted = false) {
  const complement = Boolean(result.outputInverted) !== inverted;
  let { kind, pins } = result;
  if (complement && kind === "mux") {
    pins = { ...pins, d0: { ...pins.d0, inverted: !pins.d0.inverted }, d1: { ...pins.d1, inverted: !pins.d1.inverted } };
  } else if (complement) {
    kind = kind === "xor" ? "xnor" : "xor";
  }
  return { kind, pins };
}

export function structureFormula(result, label = (id) => id, root = false) {
  const { kind, pins } = root ? structureFunctionAtUse(result) : result;
  const pin = (key) => `${pins[key].inverted ? "¬" : ""}${label(pins[key].nodeId)}`;
  const expression = kind === "mux" ? `${pin("s")} ? ${pin("d1")} : ${pin("d0")}` : `${pin("a")} ⊕ ${pin("b")}`;
  return kind === "xnor" ? `¬(${expression})` : expression;
}
