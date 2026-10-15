const GEOMETRY_EPSILON = 0.01;

/**
 * Reduce a provider's already-valid logical routes to one deterministic
 * physical tree per driver/net group. No new geometry is invented here: the
 * tree is a union of shortest paths through the provider segments, so node
 * obstacle validation remains authoritative on the original logical routes.
 */
export function buildNetTreeSegments(segments = [], edges = []) {
  const usable = segments
    .map((segment, index) => toSegmentRecord(segment, index))
    .filter(Boolean);
  if (usable.length === 0) {
    return {
      segments: [],
      topology: "tree",
      treeFallback: false,
      componentCount: 0,
      cycleCount: 0,
      reachableTargetCount: edges.length
    };
  }

  const adjacency = buildAdjacency(usable);
  const sourceKeys = uniquePointKeys(edges.map((edge) => edge?.points?.[0]));
  const targetRecords = edges
    .toSorted(compareEdges)
    .map((edge) => ({
      edgeId: String(edge?.id ?? `${edge?.source || ""}:${edge?.target || ""}`),
      pointKey: pointKey(edge?.points?.at(-1))
    }));
  const shortestPaths = findMultiSourceTree(adjacency, sourceKeys);
  const selectedIndices = new Set();
  const ownership = new Map();
  let reachableTargetCount = 0;
  for (const target of targetRecords) {
    if (!target.pointKey || !shortestPaths.distance.has(target.pointKey)) continue;
    reachableTargetCount += 1;
    let cursor = target.pointKey;
    const visited = new Set();
    while (!sourceKeys.includes(cursor)) {
      if (visited.has(cursor)) break;
      visited.add(cursor);
      const parent = shortestPaths.parent.get(cursor);
      if (!parent) break;
      selectedIndices.add(parent.segmentIndex);
      if (!ownership.has(parent.segmentIndex)) ownership.set(parent.segmentIndex, new Set());
      ownership.get(parent.segmentIndex).add(target.edgeId);
      cursor = parent.from;
    }
  }

  const treeFallback = reachableTargetCount !== targetRecords.length ||
    sourceKeys.length === 0;
  const selected = treeFallback
    ? usable
    : usable.filter((_, index) => selectedIndices.has(index));
  const routedSegments = selected.map((record) => ({
    ...record.segment,
    logicalEdgeIds: treeFallback
      ? [...record.segment.logicalEdgeIds]
      : [...(ownership.get(record.index) || record.segment.logicalEdgeIds)]
  }));
  const componentCount = countComponents(selected);
  const cycleCount = Math.max(0, selected.length - countVertices(selected) + componentCount);
  return {
    segments: routedSegments,
    topology: treeFallback || componentCount > 1 ? "forest" : "tree",
    treeFallback,
    componentCount,
    cycleCount,
    reachableTargetCount
  };
}

function findMultiSourceTree(adjacency, sourceKeys) {
  const distance = new Map();
  const parent = new Map();
  const heap = new MinHeap(compareQueueItems);
  for (const sourceKey of sourceKeys) {
    if (!adjacency.has(sourceKey)) continue;
    const current = { distance: 0, nodeKey: sourceKey, parentKey: "", segmentIndex: -1 };
    const previous = distance.get(sourceKey);
    if (previous === undefined || sourceKey < previous.nodeKey) {
      distance.set(sourceKey, current);
      heap.push(current);
    }
  }

  while (!heap.isEmpty()) {
    const current = heap.pop();
    const best = distance.get(current.nodeKey);
    if (!best || compareQueueItems(current, best) !== 0) continue;
    for (const neighbor of adjacency.get(current.nodeKey) || []) {
      const candidate = {
        distance: current.distance + neighbor.length,
        nodeKey: neighbor.to,
        parentKey: `${current.nodeKey}\u0000${neighbor.segmentIndex}`,
        segmentIndex: neighbor.segmentIndex,
        from: current.nodeKey
      };
      const previous = distance.get(neighbor.to);
      if (previous && compareQueueItems(candidate, previous) >= 0) continue;
      distance.set(neighbor.to, candidate);
      parent.set(neighbor.to, {
        from: current.nodeKey,
        segmentIndex: neighbor.segmentIndex,
        key: candidate.parentKey
      });
      heap.push(candidate);
    }
  }
  return { distance, parent };
}

function buildAdjacency(records) {
  const adjacency = new Map();
  const add = (from, value) => {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push(value);
  };
  for (const record of records) {
    const startKey = pointKey(record.segment.start);
    const endKey = pointKey(record.segment.end);
    if (!startKey || !endKey || startKey === endKey) continue;
    add(startKey, { to: endKey, segmentIndex: record.index, length: record.length });
    add(endKey, { to: startKey, segmentIndex: record.index, length: record.length });
  }
  for (const neighbors of adjacency.values()) {
    neighbors.sort((left, right) => left.to.localeCompare(right.to) || left.segmentIndex - right.segmentIndex);
  }
  return adjacency;
}

function countComponents(records) {
  const adjacency = buildAdjacency(records);
  const visited = new Set();
  let count = 0;
  for (const key of adjacency.keys()) {
    if (visited.has(key)) continue;
    count += 1;
    const stack = [key];
    visited.add(key);
    while (stack.length > 0) {
      const current = stack.pop();
      for (const neighbor of adjacency.get(current) || []) {
        if (visited.has(neighbor.to)) continue;
        visited.add(neighbor.to);
        stack.push(neighbor.to);
      }
    }
  }
  return count;
}

function countVertices(records) {
  return new Set(records.flatMap((record) => [
    pointKey(record.segment.start),
    pointKey(record.segment.end)
  ].filter(Boolean))).size;
}

function toSegmentRecord(segment, index) {
  const start = finitePoint(segment?.start);
  const end = finitePoint(segment?.end);
  if (!start || !end || pointKey(start) === pointKey(end)) return null;
  const logicalEdgeIds = segment.logicalEdgeIds instanceof Set
    ? [...segment.logicalEdgeIds]
    : Array.isArray(segment.logicalEdgeIds)
      ? segment.logicalEdgeIds
      : [];
  return {
    index,
    segment: {
      ...segment,
      start,
      end,
      logicalEdgeIds: new Set(logicalEdgeIds.map(String))
    },
    length: Math.abs(end.x - start.x) + Math.abs(end.y - start.y)
  };
}

function uniquePointKeys(points) {
  return [...new Set(points.map(pointKey).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function pointKey(point) {
  const value = finitePoint(point);
  return value ? `${quantize(value.x)}:${quantize(value.y)}` : null;
}

function finitePoint(point) {
  return point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y))
    ? { x: Number(point.x), y: Number(point.y) }
    : null;
}

function quantize(value) {
  return Math.round(value * 100) / 100;
}

function compareEdges(left, right) {
  return String(left?.id || "").localeCompare(String(right?.id || ""));
}

function compareQueueItems(left, right) {
  return left.distance - right.distance ||
    String(left.parentKey || "").localeCompare(String(right.parentKey || "")) ||
    String(left.nodeKey || "").localeCompare(String(right.nodeKey || ""));
}

class MinHeap {
  constructor(compare) {
    this.items = [];
    this.compare = compare;
  }

  push(value) {
    this.items.push(value);
    this.#bubbleUp(this.items.length - 1);
  }

  pop() {
    if (this.items.length === 0) return null;
    const first = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0) {
      this.items[0] = last;
      this.#bubbleDown(0);
    }
    return first;
  }

  isEmpty() {
    return this.items.length === 0;
  }

  #bubbleUp(index) {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(this.items[index], this.items[parent]) >= 0) break;
      [this.items[index], this.items[parent]] = [this.items[parent], this.items[index]];
      index = parent;
    }
  }

  #bubbleDown(index) {
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < this.items.length && this.compare(this.items[left], this.items[smallest]) < 0) smallest = left;
      if (right < this.items.length && this.compare(this.items[right], this.items[smallest]) < 0) smallest = right;
      if (smallest === index) break;
      [this.items[index], this.items[smallest]] = [this.items[smallest], this.items[index]];
      index = smallest;
    }
  }
}
