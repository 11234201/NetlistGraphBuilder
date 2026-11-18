import { compareStructureId } from "./structure_index.js";

// Vertex capacity one permits at most two augmentations and allows rerouting
// the first path. A greedy path followed by vertex deletion is not sufficient.
export function findDisjointPaths(index, stemId, mergeId, reachable, budget, stepCost) {
  const ancestors = new Set([mergeId]), queue = [mergeId];
  for (let offset = 0; offset < queue.length; offset++) {
    const id = queue[offset];
    if (id === stemId) continue;
    for (const edge of index.incoming.get(id)) {
      if (!budget.spend()) return null;
      if (reachable.has(edge.source) && !ancestors.has(edge.source)) { ancestors.add(edge.source); queue.push(edge.source); }
    }
  }
  if (!ancestors.has(stemId)) return [];
  const ordered = [...ancestors].sort((a, b) => index.rank.get(a) - index.rank.get(b));
  const number = new Map(ordered.map((id, slot) => [id, slot * 2]));
  const adjacency = Array.from({ length: ordered.length * 2 }, () => []);
  function add(from, to, capacity, edgeId = null) {
    const forward = { from, to, capacity, initial: capacity, edgeId }, backward = { from: to, to: from, capacity: 0, initial: 0 };
    forward.reverse = backward; backward.reverse = forward;
    adjacency[from].push(forward); adjacency[to].push(backward);
  }
  for (const id of ordered) {
    if (!budget.spend()) return null;
    add(number.get(id), number.get(id) + 1, id === stemId || id === mergeId ? 2 : 1);
    let directConnection = false;
    for (const edge of index.outgoing.get(id)) {
      if (!budget.spend()) return null;
      if (!ancestors.has(edge.target)) continue;
      if (id === stemId && edge.target === mergeId) {
        if (directConnection) continue;
        directConnection = true;
      }
      add(number.get(id) + 1, number.get(edge.target), 1, edge.id);
    }
  }
  const start = number.get(stemId) + 1, end = number.get(mergeId);
  for (let flow = 0; flow < 2; flow++) {
    const parents = new Map([[start, null]]), pending = [start];
    for (let offset = 0; offset < pending.length && !parents.has(end); offset++) {
      for (const arc of adjacency[pending[offset]]) {
        if (!budget.spend()) return null;
        if (arc.capacity && !parents.has(arc.to)) { parents.set(arc.to, arc); pending.push(arc.to); }
      }
    }
    if (!parents.has(end)) return [];
    for (let at = end; at !== start;) { const arc = parents.get(at); arc.capacity--; arc.reverse.capacity++; at = arc.from; }
  }
  const paths = [];
  for (let path = 0; path < 2; path++) {
    const nodeIds = [stemId], edgeIds = [];
    for (let at = start; at !== end;) {
      if (!budget.spend()) return null;
      const arc = adjacency[at].find((item) => item.initial > item.capacity);
      if (!arc) throw new Error("Invalid reconvergence witness flow");
      arc.capacity++; at = arc.to;
      if (arc.edgeId) { edgeIds.push(arc.edgeId); nodeIds.push(index.edgeById.get(arc.edgeId).target); }
    }
    paths.push({ nodeIds, edgeIds, depth: nodeIds.slice(1).reduce((sum, id) => sum + stepCost(index.byId.get(id)), 0) });
  }
  return paths.sort((a, b) => compareStructureId(JSON.stringify(a.edgeIds), JSON.stringify(b.edgeIds)));
}
