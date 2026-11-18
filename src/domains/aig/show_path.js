import { createPathIndex, checkPathBudget } from "../../analysis/path_query.js";

const indexes = new WeakMap();
export function aigPathIndex(model) {
  if (indexes.has(model)) return indexes.get(model);
  checkPathBudget(model.nodes.length + model.edges.length);
  const endpoints = new Map();
  const vertices = model.nodes.map((node) => {
    const label = node.primaryNameMapping?.name || node.label || node.id;
    function add(key, name, kind, copyName = name) {
      endpoints.set(key, { key, label: name, kind, copyName, starts: [node.id], ends: [node.id], displayId: node.id });
    }
    add(node.id, label, node.kind);
    for (const ref of [...(node.sourceRefs || []), ...(node.nameMappings || [])]) {
      const signal = ref.signalId || ref.id, name = ref.name || ref.label || signal;
      const key = JSON.stringify([node.id, signal, name, Boolean(ref.inverted), ref.usage || node.kind]);
      add(key, name + (name !== signal ? " / " + signal : "") + (ref.inverted ? " (inverted)" : ""), node.kind + " · " + node.id, name);
    }
    return { id: node.id, displayId: node.id, label, cost: Number(node.kind === "and"), boundary: node.kind === "po" ? "output" : null };
  });
  const index = createPathIndex(vertices, model.edges.map((e) => ({ source: e.source, target: e.target, wire: e.id })), endpoints);
  indexes.set(model, index);
  return index;
}
