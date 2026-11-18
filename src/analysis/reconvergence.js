import { createStructureBudget } from "./structure_policy.js";
import { compareStructureId } from "./structure_index.js";
import { findDisjointPaths } from "./structure_paths.js";

export function findReconvergence(index, policy, rules) {
  const budget = createStructureBudget(policy.reconvergenceWork), results = [];
  let stemsChecked = 0, witnessItems = 0;
  search: for (const stem of index.nodes) {
    if (!rules.canBranch(stem) || !index.branchSources.has(stem.id)) continue;
    if (budget.exhausted || results.length >= policy.results) break;
    if (witnessItems >= policy.witnessItems) { budget.limit("witness-limit"); break; }
    stemsChecked++;
    const reachable = new Set([stem.id]), pending = [stem.id];
    for (let offset = 0; offset < pending.length; offset++) {
      for (const edge of index.outgoing.get(pending[offset])) {
        if (!budget.spend()) break;
        if (!rules.canVisit(index.byId.get(edge.target)) || reachable.has(edge.target)) continue;
        if (reachable.size >= policy.reachNodes) { budget.limit("reach-node-limit"); continue; }
        reachable.add(edge.target); pending.push(edge.target);
      }
      if (budget.exhausted) break;
    }
    // In a DAG, immediate dominators are intersections of processed predecessor
    // chains. This prunes common tails before the two-path witness search.
    const dominator = new Map([[stem.id, stem.id]]);
    const ordered = pending.slice(1).sort((a, b) => index.rank.get(a) - index.rank.get(b));
    for (const id of ordered) {
      const incoming = index.incoming.get(id);
      // A normal node visit includes two input slots, preserving the existing
      // two-input AIG coverage. Pay for excess fanin before scanning it.
      if (!budget.spend(Math.max(1, incoming.length - 1))) break;
      const seen = new Set();
      for (const edge of incoming) {
        if (dominator.has(edge.source)) seen.add(edge.source);
      }
      const predecessors = [...seen];
      if (!predecessors.length) continue;
      let parent = predecessors[0];
      for (const predecessor of predecessors.slice(1)) {
        let other = predecessor;
        while (parent !== other) {
          if (!budget.spend()) break;
          if (index.rank.get(parent) > index.rank.get(other)) parent = dominator.get(parent); else other = dominator.get(other);
        }
      }
      if (budget.exhausted) break;
      dominator.set(id, parent);
      if (parent !== stem.id || predecessors.length < 2 || !rules.canMerge(index.byId.get(id))) continue;
      const paths = findDisjointPaths(index, stem.id, id, reachable, budget, rules.stepCost);
      if (!paths?.length) continue;
      const count = paths.reduce((sum, path) => sum + path.nodeIds.length + path.edgeIds.length, 0);
      if (witnessItems + count > policy.witnessItems) { budget.limit("witness-limit"); break search; }
      results.push({ id: `recon:${JSON.stringify([stem.id, id])}`, category: "reconvergence", stemId: stem.id, mergeId: id, paths });
      witnessItems += count;
      if (results.length >= policy.results) { budget.limit("result-limit"); break; }
    }
  }
  return { ...budget.snapshot(), stemsChecked, witnessItems, results: results.sort((a, b) => compareStructureId(a.id, b.id)) };
}

export function readReconvergenceDetail(index, result, policy) {
  const budget = createStructureBudget(policy.detailWork), ancestors = new Set([result.mergeId]), pending = [result.mergeId];
  for (let offset = 0; offset < pending.length; offset++) {
    const id = pending[offset];
    if (id === result.stemId) continue;
    for (const edge of index.incoming.get(id)) {
      if (!budget.spend()) break;
      if (index.rank.get(edge.source) < index.rank.get(result.stemId) || ancestors.has(edge.source)) continue;
      if (ancestors.size >= policy.detailNodes) { budget.limit("detail-node-limit"); continue; }
      ancestors.add(edge.source); pending.push(edge.source);
    }
    if (budget.exhausted) break;
  }
  const nodeIds = new Set(result.paths.flatMap((path) => path.nodeIds)), edgeIds = new Set(result.paths.flatMap((path) => path.edgeIds));
  const reached = new Set([result.stemId]), queue = [result.stemId];
  for (let offset = 0; offset < queue.length; offset++) {
    if (queue[offset] === result.mergeId) continue;
    for (const edge of index.outgoing.get(queue[offset])) {
      if (!budget.spend()) break;
      if (!ancestors.has(edge.target)) continue;
      edgeIds.add(edge.id); nodeIds.add(edge.source); nodeIds.add(edge.target);
      if (!reached.has(edge.target)) { reached.add(edge.target); queue.push(edge.target); }
    }
    if (budget.exhausted) break;
  }
  return { id: result.id, ...budget.snapshot(), nodeIds: [...nodeIds].sort(compareStructureId), edgeIds: [...edgeIds].sort(compareStructureId) };
}
