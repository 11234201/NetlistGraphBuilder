import { collectCut, compareStructureId } from "./structure_index.js";
import { classifyStructureFunction, evaluateCut, minimizeStructureFunction } from "./structure_functions.js";
import { createStructureBudget } from "./structure_policy.js";

export function findStructureBlocks(index, policy) {
  const budget = createStructureBudget(policy.blockWork), found = new Map();
  let rootsChecked = 0, cachedCount = 0;
  const inspect = (root, leaves) => {
    if (leaves.length > 3 || budget.exhausted) return;
    const key = JSON.stringify([root.id, leaves]);
    if (found.has(key)) return;
    const cone = collectCut(index, root.id, leaves, policy.blockNodes, budget);
    if (!cone) return;
    const value = minimizeStructureFunction(evaluateCut(index, root.id, leaves, cone.nodeIds), leaves);
    const match = classifyStructureFunction(value.truth, value.inputs.length);
    if (!match) return;
    if (found.size >= policy.results) { budget.limit("result-limit"); return; }
    found.set(key, { id: `block:${key}`, category: "block", rootId: root.id, kind: match.kind,
      boundaryIds: leaves, inputIds: value.inputs, nodeIds: cone.nodeIds, edgeIds: cone.edgeIds,
      truthTable: value.truth, outputInverted: match.outputInverted,
      pins: Object.fromEntries(Object.entries(match.roles).map(([role, slot]) => [role, { nodeId: value.inputs[slot], inverted: match.inversions[role] }])) });
  };
  // Complete constant-size structural checks run before priority-cut truncation.
  for (const root of index.nodes) {
    if (root.kind !== "and") continue;
    if (!budget.spend()) break;
    rootsChecked++;
    const children = index.incoming.get(root.id).map((edge) => index.byId.get(edge.source));
    if (!children.every((node) => node.kind === "and")) continue;
    const leaves = [...new Set(children.flatMap((node) => index.incoming.get(node.id).map((edge) => edge.source)))].filter((id) => index.byId.get(id).kind !== "constant").sort(compareStructureId);
    inspect(root, leaves);
  }
  const cuts = new Map();
  for (const root of index.nodes) {
    if (budget.exhausted) break;
    if (root.kind === "po") continue;
    if (cachedCount >= policy.cachedCuts) { budget.limit("cut-cache-limit"); break; }
    if (root.kind !== "and") { cuts.set(root.id, [root.kind === "constant" ? [] : [root.id]]); cachedCount++; continue; }
    const [first, second] = index.incoming.get(root.id);
    const candidates = new Map();
    for (const left of cuts.get(first.source) || []) {
      for (const right of cuts.get(second.source) || []) {
        if (!budget.spend()) break;
        const leaves = [...new Set([...left, ...right])].sort(compareStructureId);
        if (leaves.length > 3) continue;
        const key = JSON.stringify(leaves);
        if (!candidates.has(key)) { candidates.set(key, leaves); inspect(root, leaves); }
      }
      if (budget.exhausted) break;
    }
    const ordered = [...candidates.values()].sort((a, b) => a.length - b.length || compareStructureId(JSON.stringify(a), JSON.stringify(b)));
    const available = Math.min(policy.cutsPerNode - 1, policy.cachedCuts - cachedCount - 1);
    if (ordered.length > available) budget.limit("cut-limit");
    const retained = [[root.id], ...ordered.slice(0, Math.max(0, available))];
    cuts.set(root.id, retained); cachedCount += retained.length;
  }
  return { ...budget.snapshot(), rootsChecked, cachedCuts: cachedCount,
    results: [...found.values()].sort((a, b) => compareStructureId(a.rootId, b.rootId) || compareStructureId(a.id, b.id)) };
}
