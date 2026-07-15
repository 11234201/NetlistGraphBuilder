export function compareNodes(left, right) {
  const leftOrder = left.order ?? 1000;
  const rightOrder = right.order ?? 1000;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  return `${left.kind}:${left.label}`.localeCompare(`${right.kind}:${right.label}`) ||
    String(left.id || "").localeCompare(String(right.id || ""));
}

export function groupEdges(edges, key) {
  const groups = new Map();
  for (const edge of edges) {
    const id = edge[key];
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(edge);
  }
  return groups;
}

export function getInputPorts(node) {
  return (node?.ports || []).filter((port) => port.direction === "input");
}

export function getInputPortIndex(node, pin) {
  const ports = getInputPorts(node);
  const index = ports.findIndex((port) => port.pin === pin);
  return index >= 0 ? index : 0;
}

export function findNearestFreeY(node, preferredY, nodes, ignoredIds, margin, gap = 12) {
  const blockers = nodes.filter((candidate) =>
    !ignoredIds.has(candidate.id) && horizontalRangesOverlap(node, candidate, gap)
  );
  const candidates = [preferredY];
  for (const blocker of blockers) {
    candidates.push(blocker.y - node.height - gap, blocker.y + blocker.height + gap);
  }

  for (const y of candidates
    .map((candidate) => Math.max(margin, round(candidate)))
    .toSorted((left, right) => Math.abs(left - preferredY) - Math.abs(right - preferredY))) {
    const overlaps = blockers.some((blocker) =>
      y < blocker.y + blocker.height + gap && y + node.height + gap > blocker.y
    );
    if (!overlaps) return y;
  }
  return Math.max(margin, preferredY);
}

export function isExternalSourceNode(node) {
  return node?.kind === "input" || node?.kind === "implicit" || node?.kind === "constant";
}

export function round(value) {
  return Math.round(value * 1000) / 1000;
}

function horizontalRangesOverlap(left, right, gap = 0) {
  return left.x < right.x + right.width + gap && left.x + left.width + gap > right.x;
}
