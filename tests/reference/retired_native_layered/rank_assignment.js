export const DEFAULT_RANK_POLICY = Object.freeze({ refinementSweeps: 8 });

export function AssignRanks(model, orientation, policy = {}) {
  const refinementSweeps = ClampInteger(policy.refinementSweeps, 0, 64, DEFAULT_RANK_POLICY.refinementSweeps);
  const edges = orientation.edges.filter((edge) => !edge.ignoredForLayering);
  const incoming = new Map(model.nodes.map((node) => [node.key, []]));
  const outgoing = new Map(model.nodes.map((node) => [node.key, []]));
  const indegree = new Map(model.nodes.map((node) => [node.key, 0]));
  for (const edge of edges) {
    outgoing.get(edge.layoutSourceKey).push(edge);
    incoming.get(edge.layoutTargetKey).push(edge);
    indegree.set(edge.layoutTargetKey, indegree.get(edge.layoutTargetKey) + 1);
  }
  SortEdgeLists(incoming);
  SortEdgeLists(outgoing);
  const ready = model.nodes.map((node) => node.key).filter((key) => indegree.get(key) === 0).sort(CompareText);
  const topologicalOrder = [];
  while (ready.length > 0) {
    const key = ready.shift();
    topologicalOrder.push(key);
    for (const edge of outgoing.get(key)) {
      const target = edge.layoutTargetKey;
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) InsertSorted(ready, target);
    }
  }
  if (topologicalOrder.length !== model.nodes.length) {
    throw new Error("Native Layered cycle breaking did not produce an acyclic orientation");
  }

  const ranks = new Map(model.nodes.map((node) => [node.key, 0]));
  for (const key of topologicalOrder) {
    for (const edge of outgoing.get(key)) {
      ranks.set(edge.layoutTargetKey, Math.max(
        ranks.get(edge.layoutTargetKey),
        ranks.get(key) + edge.minimumLength
      ));
    }
  }

  // Bounded coordinate descent reduces total span without weakening any
  // minimum-length constraint. Primary module ports stay at their boundaries.
  const kindByKey = new Map(model.nodes.map((node) => [node.key, node.kind]));
  for (let sweep = 0; sweep < refinementSweeps; sweep += 1) {
    let moved = false;
    const order = sweep % 2 === 0 ? topologicalOrder.toReversed() : topologicalOrder;
    for (const key of order) {
      if (kindByKey.get(key) === "input" || kindByKey.get(key) === "output") continue;
      const predecessors = incoming.get(key);
      const successors = outgoing.get(key);
      const lower = predecessors.length > 0
        ? Math.max(...predecessors.map((edge) => ranks.get(edge.layoutSourceKey) + edge.minimumLength))
        : ranks.get(key);
      const upper = successors.length > 0
        ? Math.min(...successors.map((edge) => ranks.get(edge.layoutTargetKey) - edge.minimumLength))
        : ranks.get(key);
      const preferred = predecessors.length > successors.length ? lower
        : successors.length > predecessors.length ? upper
        : ranks.get(key);
      if (Number.isFinite(preferred) && preferred !== ranks.get(key)) {
        ranks.set(key, preferred);
        moved = true;
      }
    }
    if (!moved) break;
  }
  ShiftRanksToOrigin(ranks);
  return Object.freeze({ ranks, topologicalOrder: Object.freeze(topologicalOrder), refinementSweeps });
}

function SortEdgeLists(index) {
  for (const values of index.values()) values.sort((left, right) => CompareText(left.key, right.key));
}

function InsertSorted(values, value) {
  let index = 0;
  while (index < values.length && CompareText(values[index], value) < 0) index += 1;
  values.splice(index, 0, value);
}

function ShiftRanksToOrigin(ranks) {
  const minimum = Math.min(0, ...ranks.values());
  if (minimum === 0) return;
  for (const [key, rank] of ranks) ranks.set(key, rank - minimum);
}

function ClampInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.floor(number))) : fallback;
}

function CompareText(left, right) {
  return String(left).localeCompare(String(right));
}
