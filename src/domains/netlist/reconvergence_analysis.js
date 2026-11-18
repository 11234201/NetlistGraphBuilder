import { createOrderedStructureIndex } from "../../analysis/structure_index.js";
import { normalizeStructurePolicy } from "../../analysis/structure_policy.js";
import { findReconvergence } from "../../analysis/reconvergence.js";

const rules = {
  canBranch: (node) => ["input", "driver", "assign"].includes(node.role),
  canVisit: () => true,
  canMerge: (node) => node.role === "gate",
  stepCost: (node) => Number(node.role === "gate")
};

export function createNetlistStructureIndex(model) {
  const outgoing = new Map(), degree = new Map(), level = new Map();
  for (const node of model.nodes) {
    outgoing.set(node.id, []); degree.set(node.id, 0); level.set(node.id, 0);
  }
  for (const edge of model.edges) {
    outgoing.get(edge.source).push(edge.target);
    degree.set(edge.target, degree.get(edge.target) + 1);
  }
  const ready = model.nodes.filter((node) => !degree.get(node.id)).map((node) => node.id);
  for (let i = 0; i < ready.length; i++) {
    const id = ready[i];
    for (const target of outgoing.get(id)) {
      level.set(target, Math.max(level.get(target), level.get(id) + 1));
      degree.set(target, degree.get(target) - 1);
      if (!degree.get(target)) ready.push(target);
    }
  }
  const resolved = new Set(ready), reasons = new Set(model.reasons);
  if (ready.length !== model.nodes.length) reasons.add("combinational-cycle");
  const nodes = model.nodes.filter((node) => resolved.has(node.id)).map((node) => ({ ...node, level: level.get(node.id) }));
  const edges = model.edges.filter((edge) => resolved.has(edge.source) && resolved.has(edge.target));
  return { ...createOrderedStructureIndex({ nodes, edges }), reasons: [...reasons].sort() };
}

export function analyzeNetlistReconvergence(index, options = {}) {
  const reconvergence = findReconvergence(index, normalizeStructurePolicy(options), rules);
  const reasons = [...new Set([...index.reasons, ...reconvergence.reasons])].sort();
  const status = reasons.length ? "partial" : "complete";
  return { status, reconvergence: { ...reconvergence, status, reasons } };
}
