import { AIG_IMPORT_LIMITS, requireAig } from "./aig_diagnostics.js";

export const AIG_NORMALIZATION_VERSION = 1;

// Forward structure, output-use context and bounded partition refinement label
// the graph. Independent AND objects are never structurally merged. A remaining
// true symmetry has interchangeable display identities, with explicit per-source
// provenance retained for the selected representative.
export function normalizeAig(raw, options = {}) {
  const context = { format: raw.format, name: options.name };
  requireAig(raw.nodes.length + raw.outputs.length <= AIG_IMPORT_LIMITS.objects, "AIG object count exceeds the 100000-object import limit", context);
  const bySource = new Map(raw.nodes.map((node) => [node.id, node]));
  requireAig(bySource.size === raw.nodes.length, "Duplicate source object identity", context);
  const pending = new Map();
  const users = new Map(raw.nodes.map((node) => [node.id, []]));
  for (const node of raw.nodes) {
    // A simplified constant or literal still has to validate all input names
    // and combinational dependencies declared by its source table.
    const dependencies = node.declaredInputs || node.fanins.map((edge) => edge.source);
    for (const dependency of dependencies) {
      requireAig(bySource.has(dependency), `Undefined signal '${dependency}' used by '${node.generatedFor || node.id}'`, context, node, "aig.undefined-input");
      users.get(dependency).push(node.id);
    }
    pending.set(node.id, dependencies.length);
  }
  const queue = raw.nodes.filter((node) => pending.get(node.id) === 0).map((node) => node.id);
  const signals = new Map();
  const vertices = [];
  let constant = null;
  const vertex = (value) => {
    const result = { index: vertices.length, incoming: [], outgoing: [], sourceRefs: [], ...value };
    vertices.push(result);
    return result;
  };
  const connect = (driver, target, inverted, sourceRef) => {
    const edge = { source: driver.index, target: target.index, inverted, sourceRef };
    target.incoming.push(edge); driver.outgoing.push(edge);
  };
  for (let offset = 0; offset < queue.length; offset++) {
    const node = bySource.get(queue[offset]);
    const literals = node.fanins.map((edge, slot) => {
      const source = signals.get(edge.source);
      const generatedFor = node.generatedFor || bySource.get(edge.source).generatedFor;
      return { vertex: source.vertex, inverted: source.inverted !== edge.inverted,
        sourceRef: { id: edge.source, targetId: node.id, slot, sourceInverted: edge.inverted, line: edge.line, column: edge.column,
          ...(generatedFor ? { generatedFor } : {}) } };
    });
    let signal;
    if (node.kind === "pi") signal = { vertex: vertex({ kind: "pi", label: node.label, level: 0 }), inverted: false };
    else if (node.kind === "constant") {
      constant ||= vertex({ kind: "constant", label: "0", level: 0 });
      signal = { vertex: constant, inverted: Boolean(node.value) };
    } else if (node.kind === "alias") signal = { vertex: literals[0].vertex, inverted: literals[0].inverted };
    else {
      requireAig(node.kind === "and" && literals.length === 2, `Invalid AND object '${node.id}'`, context, node);
      const result = vertex({ kind: "and", level: 1 + Math.max(...literals.map((literal) => literal.vertex.level)) });
      for (const literal of literals) connect(literal.vertex, result, literal.inverted, literal.sourceRef);
      signal = { vertex: result, inverted: Boolean(node.outputInverted) };
    }
    signal.vertex.sourceRefs.push({ id: node.id, label: node.label, line: node.line, column: node.column, inverted: signal.inverted,
      ...(node.generatedFor ? { generatedFor: node.generatedFor } : {}) });
    signals.set(node.id, signal);
    for (const user of users.get(node.id)) {
      const remaining = pending.get(user) - 1;
      pending.set(user, remaining);
      if (remaining === 0) queue.push(user);
    }
  }
  if (signals.size !== raw.nodes.length) {
    const node = raw.nodes.find((item) => !signals.has(item.id));
    requireAig(false, `Combinational cycle near '${node.generatedFor || node.id}'`, context, node, "aig.cycle");
  }
  for (const output of raw.outputs) {
    const signal = signals.get(output.source);
    requireAig(signal, `Undefined output signal '${output.source}'`, context, output);
    const result = vertex({ kind: "po", label: output.label, level: signal.vertex.level });
    result.sourceRefs.push({ id: output.id, label: output.label, line: output.line, column: output.column, inverted: false });
    connect(signal.vertex, result, Boolean(signal.inverted !== output.inverted), { id: output.source, targetId: output.id, slot: 0, sourceInverted: output.inverted, line: output.line, column: output.column });
  }
  const active = vertices.filter((node) => node !== constant || node.outgoing.length > 0);
  const order = canonicalOrder(active, context);
  const identities = new Map();
  let nodeNumber = 1;
  let outputNumber = 0;
  for (const node of order) identities.set(node.index, node.kind === "constant" ? "n0" : node.kind === "po" ? `po${outputNumber++}` : `n${nodeNumber++}`);
  const nodes = [];
  const edges = [];
  for (const node of order) {
    const id = identities.get(node.index);
    nodes.push({ id, kind: node.kind, label: node.kind === "and" ? id.slice(1) : node.label, level: node.level, sourceRefs: sortRefs(node.sourceRefs) });
    const incoming = [...node.incoming].sort((first, second) => compare(identities.get(first.source), identities.get(second.source)) || Number(first.inverted) - Number(second.inverted));
    incoming.forEach((edge, slot) => edges.push({ id: `${id}:${slot}`, source: identities.get(edge.source), target: id, slot, inverted: edge.inverted, sourceRefs: [{ ...edge.sourceRef, inverted: edge.inverted }] }));
  }
  const provenance = [...signals].map(([id, signal]) => ({ id, nodeId: identities.get(signal.vertex.index) || null, inverted: signal.inverted, label: bySource.get(id).label, line: bySource.get(id).line, column: bySource.get(id).column })).sort((first, second) => compare(first.id, second.id));
  return { normalizationVersion: AIG_NORMALIZATION_VERSION, nodes, edges, provenance };
}

function canonicalOrder(active, context) {
  const topological = [...active].sort((first, second) => first.level - second.level || kindOrder(first) - kindOrder(second));
  const forward = new Map();
  const reverse = new Map();
  let serial = 0;
  // Assign exact, compressed signatures by layer: deep chains never build
  // exponentially long structural strings or consume the JS recursion stack.
  for (const layer of layers(topological)) {
    const keys = layer.map((node) => node.kind === "and" ? JSON.stringify(node.incoming.map((edge) => [forward.get(edge.source), edge.inverted]).sort(tupleCompare)) : JSON.stringify([node.kind, node.label]));
    const ids = new Map([...new Set(keys)].sort(compare).map((key) => [key, serial++]));
    layer.forEach((node, index) => forward.set(node.index, ids.get(keys[index])));
  }
  serial = 0;
  for (const layer of layers([...topological].reverse())) {
    const keys = layer.map((node) => JSON.stringify([node.kind === "po" ? node.label : null, node.outgoing.map((edge) => [reverse.get(edge.target), forward.get(edge.target), edge.inverted]).sort(tupleCompare)]));
    const ids = new Map([...new Set(keys)].sort(compare).map((key) => [key, serial++]));
    layer.forEach((node, index) => reverse.set(node.index, ids.get(keys[index])));
  }
  let work = 0;
  const cost = active.length + active.reduce((sum, node) => sum + node.incoming.length, 0);
  const consume = () => {
    work += cost;
    requireAig(work <= AIG_IMPORT_LIMITS.normalizationWork, "AIG canonical identity work budget exceeded; use a smaller graph", context);
  };
  const compress = (keys) => {
    const ids = new Map([...new Set(keys.values())].sort(compare).map((key, index) => [key, index]));
    return new Map([...keys].map(([id, key]) => [id, ids.get(key)]));
  };
  const initial = compress(new Map(active.map((node) => [node.index, JSON.stringify([node.kind, node.level, forward.get(node.index), reverse.get(node.index)])])));
  function refine(seed) {
    let colors = seed;
    let count = new Set(colors.values()).size;
    while (true) {
      consume();
      const next = compress(new Map(active.map((node) => [node.index, JSON.stringify([colors.get(node.index), node.incoming.map((edge) => [colors.get(edge.source), edge.inverted]).sort(tupleCompare), node.outgoing.map((edge) => [colors.get(edge.target), edge.inverted]).sort(tupleCompare)])])));
      const nextCount = new Set(next.values()).size;
      colors = next;
      if (nextCount === count) return colors;
      count = nextCount;
    }
  }
  const stack = [initial];
  let best = null;
  while (stack.length) {
    const colors = refine(stack.pop());
    const cells = new Map();
    for (const node of active) {
      const color = colors.get(node.index);
      if (!cells.has(color)) cells.set(color, []);
      cells.get(color).push(node);
    }
    const cell = [...cells].sort((first, second) => first[0] - second[0]).find(([, group]) => group.length > 1 && !areTwins(group))?.[1];
    if (cell) {
      let unique = 0;
      for (const color of colors.values()) unique = Math.max(unique, color + 1);
      for (const node of cell) {
        consume();
        const branch = new Map(colors);
        branch.set(node.index, unique);
        stack.push(branch);
      }
      continue;
    }
    const order = [...active].sort((first, second) => kindOrder(first) - kindOrder(second) || first.level - second.level || (first.kind === "pi" || first.kind === "po" ? compare(first.label, second.label) : colors.get(first.index) - colors.get(second.index)) || compare(first.sourceRefs[0]?.id || "", second.sourceRefs[0]?.id || ""));
    const positions = new Map(order.map((node, index) => [node.index, index]));
    const code = JSON.stringify(order.map((node) => [node.kind, node.label || "", node.incoming.map((edge) => [positions.get(edge.source), edge.inverted]).sort(tupleCompare)]));
    if (!best || code < best.code) best = { code, order };
  }
  return best.order;
}

function areTwins(group) {
  const key = (node) => JSON.stringify([node.incoming.map((edge) => [edge.source, edge.inverted]).sort(tupleCompare), node.outgoing.map((edge) => [edge.target, edge.inverted]).sort(tupleCompare)]);
  const first = key(group[0]);
  return group.every((node) => key(node) === first);
}

function layers(nodes) {
  const result = [];
  let previous = "";
  for (const node of nodes) {
    const key = `${node.level}:${kindOrder(node)}`;
    if (key !== previous) { result.push([]); previous = key; }
    result.at(-1).push(node);
  }
  return result;
}

function kindOrder(node) { return { constant: 0, pi: 1, and: 2, po: 3 }[node.kind]; }
function compare(first, second) { return first < second ? -1 : first > second ? 1 : 0; }
function tupleCompare(first, second) { return compare(JSON.stringify(first), JSON.stringify(second)); }
function sortRefs(refs) { return [...refs].sort((first, second) => compare(first.id, second.id)); }
