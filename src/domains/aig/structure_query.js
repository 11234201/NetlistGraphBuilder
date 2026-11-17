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
  const query = Object.freeze({
    formula: structureFormula, typeNames: AIG_BLOCK_NAMES,
    get: (id) => byId.get(id) || null,
    list(category = "reconvergence", type = "all") { return category === "block" ? type === "all" ? data.blocks.results : types.get(type) || [] : data.reconvergence.results; },
    rootEntries: () => roots.entries(), uniqueRoots: roots.size,
    related(nodeIds, category, excludeId = null) {
      const ids = new Set();
      for (const nodeId of nodeIds) for (const id of membership.get(nodeId) || []) if (id !== excludeId && byId.get(id).category === category) ids.add(id);
      return [...ids].sort().map((id) => byId.get(id));
    }
  });
  cache.set(data, query); return query;
}

export function structureFormula(result, label = (id) => id, root = false) {
  const pin = (key) => `${result.pins[key].inverted ? "¬" : ""}${label(result.pins[key].nodeId)}`;
  const expression = result.kind === "mux" ? `${pin("s")} ? ${pin("d1")} : ${pin("d0")}` : `${pin("a")} ⊕ ${pin("b")}`;
  return (result.kind === "xnor" || root && result.outputInverted) ? `¬(${expression})` : expression;
}
