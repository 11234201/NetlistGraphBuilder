// Complete each subtree once. Consecutive segments on the same unbranched
// path share their ordered membership; segment geometry remains independent.
export function measuredTargetTree(records, { distance, parent }, targets) {
  const vertices = new Map();
  for (const key of distance.keys()) vertices.set(key, { children: 0, groups: [] });
  for (const { from } of parent.values()) vertices.get(from).children++;
  const rank = new Map();
  for (const target of targets) {
    const node = vertices.get(target.pointKey);
    if (!node) return null; // A disconnected route uses original ownership.
    if (!rank.has(target.edgeId)) rank.set(target.edgeId, rank.size);
    (node.terminals ??= new Set()).add(target.edgeId);
  }
  const ready = [];
  for (const [key, node] of vertices) if (!node.children) ready.push(key);
  const owners = [];
  let componentCount = 0;
  let processed = 0;
  while (ready.length) {
    const key = ready.pop();
    const node = vertices.get(key);
    processed++;
    const link = parent.get(key);
    if (!link) {
      if (node.hasSelectedChild) componentCount++;
      continue;
    }
    const next = vertices.get(link.from);
    if (node.terminals) node.groups.push([...node.terminals]);
    if (node.groups.length) {
      // Every group's IDs are already in target order. Materialize the union
      // only at real fan-in points or when another terminal ends on this net.
      let ids = node.groups[0];
      if (node.groups.length > 1) {
        const unique = new Set();
        for (const group of node.groups) for (const id of group) unique.add(id);
        ids = [...unique].sort((a, b) => rank.get(a) - rank.get(b));
      }
      owners[link.segmentIndex] = ids;
      next.groups.push(ids);
      next.hasSelectedChild = true;
    }
    next.children--;
    if (next.children === 0) ready.push(link.from);
  }
  // Overflow or malformed ownership must retain the guarded walk fallback.
  if (processed !== vertices.size) return null;
  return { segments: records.filter((record) => owners[record.index]).map((record) => ({
    ...record.segment, logicalEdgeIds: owners[record.index]
  })), topology: componentCount > 1 ? "forest" : "tree", treeFallback: false,
    componentCount, cycleCount: 0, reachableTargetCount: targets.length };
}
