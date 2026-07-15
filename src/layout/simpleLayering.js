import { compareNodes } from "./nodePlacementShared.js";

export function assignSimpleLevels(graph) {
  const levels = new Map();
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, []]));
  const indegree = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    outgoing.get(edge.source).push(edge.target);
    indegree.set(edge.target, indegree.get(edge.target) + 1);
  }

  for (const node of graph.nodes) {
    levels.set(node.id, isExternalLevelSource(node) ? 0 : 1);
  }

  const queue = graph.nodes
    .filter((node) => indegree.get(node.id) === 0)
    .map((node) => node.id);
  const processed = new Set();
  let cursor = 0;
  let cycleCursor = 0;
  while (processed.size < graph.nodes.length) {
    if (cursor >= queue.length) {
      // Sequential graphs commonly contain feedback. Break one remaining cycle
      // edge instead of repeatedly increasing levels without a bound.
      while (cycleCursor < graph.nodes.length && processed.has(graph.nodes[cycleCursor].id)) {
        cycleCursor += 1;
      }
      const cycleEntry = graph.nodes[cycleCursor];
      if (!cycleEntry) break;
      queue.push(cycleEntry.id);
    }
    const nodeId = queue[cursor++];
    if (processed.has(nodeId)) continue;
    processed.add(nodeId);
    const nextLevel = (levels.get(nodeId) || 0) + 1;
    for (const targetId of outgoing.get(nodeId) || []) {
      if (processed.has(targetId)) continue;
      levels.set(targetId, Math.max(levels.get(targetId) || 1, nextLevel));
      const remaining = indegree.get(targetId) - 1;
      indegree.set(targetId, remaining);
      if (remaining === 0) queue.push(targetId);
    }
  }
  return levels;
}

export function orderSimpleLayers(buckets, levelKeys, edges) {
  const orders = new Map();
  const incomingByNode = new Map();
  const outgoingByNode = new Map();
  for (const edge of edges) {
    if (!incomingByNode.has(edge.target)) incomingByNode.set(edge.target, []);
    if (!outgoingByNode.has(edge.source)) outgoingByNode.set(edge.source, []);
    incomingByNode.get(edge.target).push(edge.source);
    outgoingByNode.get(edge.source).push(edge.target);
  }
  for (const level of levelKeys) {
    const nodes = buckets.get(level).sort(compareNodes);
    buckets.set(level, nodes);
    nodes.forEach((node, index) => orders.set(node.id, index));
  }

  for (let pass = 0; pass < 4; pass += 1) {
    for (const level of levelKeys.slice(1)) {
      sortLevelByNeighbors(buckets, orders, incomingByNode, level);
    }
    for (const level of levelKeys.slice(0, -1).toReversed()) {
      sortLevelByNeighbors(buckets, orders, outgoingByNode, level);
    }
  }
}

function sortLevelByNeighbors(buckets, orders, neighborsByNode, level) {
  const nodes = buckets.get(level);
  if (!nodes || nodes.length <= 1) return;
  const neighborRanks = new Map(nodes.map((node) => [
    node.id,
    (neighborsByNode.get(node.id) || [])
      .filter((neighborId) => orders.has(neighborId))
      .map((neighborId) => orders.get(neighborId))
  ]));

  nodes.sort((left, right) => {
    const leftRank = averageRank(neighborRanks.get(left.id), orders.get(left.id));
    const rightRank = averageRank(neighborRanks.get(right.id), orders.get(right.id));
    if (leftRank !== rightRank) return leftRank - rightRank;
    return compareNodes(left, right);
  });
  nodes.forEach((node, index) => orders.set(node.id, index));
}

function averageRank(values, fallback) {
  if (!values || values.length === 0) return fallback ?? 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isExternalLevelSource(node) {
  return node.kind === "input" || node.kind === "implicit" || node.kind === "constant";
}
