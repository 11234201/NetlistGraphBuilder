export function getNetGroupKey(edge) {
  return `${edge?.source || ""}\u0000${edge?.net || edge?.label || edge?.id || ""}`;
}

export function compareGraphEdges(left, right) {
  return compareText(getNetGroupKey(left), getNetGroupKey(right)) ||
    compareText(left?.sourcePin, right?.sourcePin) ||
    compareText(left?.target, right?.target) ||
    compareText(left?.targetPin, right?.targetPin) ||
    compareText(left?.id, right?.id);
}

export function groupEdgesByNet(edges) {
  const groups = new Map();
  for (const edge of edges.toSorted(compareGraphEdges)) {
    const key = getNetGroupKey(edge);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(edge);
  }
  return groups;
}

export function createFanoutPriorityComparator(edges) {
  const fanoutByGroup = new Map();
  for (const edge of edges) {
    const key = getNetGroupKey(edge);
    fanoutByGroup.set(key, (fanoutByGroup.get(key) || 0) + 1);
  }
  return (left, right) =>
    (fanoutByGroup.get(getNetGroupKey(left)) || 1) -
      (fanoutByGroup.get(getNetGroupKey(right)) || 1) ||
    compareGraphEdges(left, right);
}

function compareText(left, right) {
  return String(left || "").localeCompare(String(right || ""));
}
