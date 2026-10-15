export const DEFAULT_BLOCK_PLACEMENT_POLICY = Object.freeze({
  layerGap: 104,
  nodeGap: 32,
  dummyGap: 8,
  groupGap: 96,
  margin: 40,
  compactionPasses: 1
});

/** Four-direction median alignment with block-atomic compaction. */
export function PlaceAlignmentBlocks(proper, crossing, policy = {}) {
  const normalized = NormalizePolicy(policy);
  const nodeByKey = new Map(proper.nodes.map((node) => [node.key, node]));
  const variants = [
    { vertical: "down", horizontal: "left" },
    { vertical: "down", horizontal: "right" },
    { vertical: "up", horizontal: "left" },
    { vertical: "up", horizontal: "right" }
  ].map((direction) => BuildCandidate(proper, crossing.layers, nodeByKey, normalized, direction));
  const coordinateSets = variants.map((variant) => new Map(variant.nodes.map((node) => [node.key, node.y])));
  const xByRank = BuildRankXs(crossing.layers, nodeByKey, normalized);
  const nodes = proper.nodes.map((node) => {
    const ys = coordinateSets.map((coordinates) => coordinates.get(node.key)).sort((left, right) => left - right);
    const y = ys.length % 2 ? ys[Math.floor(ys.length / 2)] : (ys[1] + ys[2]) / 2;
    return {
      key: node.key,
      x: xByRank.get(node.rank),
      y: Round(y),
      width: node.width,
      height: node.height,
      rank: node.rank,
      dummy: node.dummy,
      logicalEdgeKey: node.logicalEdgeKey ?? null,
      physicalNetKey: node.physicalNetKey ?? null
    };
  });
  ResolveBalancedOverlaps(nodes, crossing.layers, normalized.nodeGap, normalized.dummyGap,
    crossing.groupByNode, normalized.groupGap);
  if (!nodes.some((node) => node.dummy)) CenterRecursiveTrees(nodes, proper.segments);
  const minimumY = Math.min(...nodes.map((node) => node.y), normalized.margin);
  const shift = minimumY < normalized.margin ? normalized.margin - minimumY : 0;
  const shifted = nodes.map((node) => Object.freeze({ ...node, y: Round(node.y + shift) }));
  return Object.freeze({
    nodes: Object.freeze(shifted),
    variants: Object.freeze(variants),
    blockCount: variants[0]?.blocks.length || 0,
    policy: Object.freeze(normalized)
  });
}

function CenterRecursiveTrees(nodes, segments) {
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const children = new Map();
  const parentCount = new Map();
  for (const segment of segments) {
    const values = children.get(segment.sourceKey) || [];
    values.push(segment.targetKey);
    children.set(segment.sourceKey, values);
    parentCount.set(segment.targetKey, (parentCount.get(segment.targetKey) || 0) + 1);
  }
  const parents = [...children.keys()].sort((left, right) =>
    (byKey.get(right)?.rank || 0) - (byKey.get(left)?.rank || 0) || CompareText(left, right));
  for (const key of parents) {
    const node = byKey.get(key);
    const childNodes = children.get(key).filter((childKey) =>
      parentCount.get(childKey) === 1 && byKey.has(childKey)).map((childKey) => byKey.get(childKey));
    if (!node || childNodes.length === 0) continue;
    const centers = childNodes.map((child) => child.y + child.height / 2);
    node.y = Round((Math.min(...centers) + Math.max(...centers)) / 2 - node.height / 2);
  }
}

function BuildCandidate(proper, layers, nodeByKey, policy, direction) {
  const parent = new Map(proper.nodes.map((node) => [node.key, node.key]));
  const blockRanks = new Map(proper.nodes.map((node) => [node.key, new Set([node.rank])]));
  const layerOrder = new Map();
  for (const layer of layers) layer.nodeKeys.forEach((key, index) => layerOrder.set(key, index));
  const adjacent = BuildAdjacent(proper.segments, direction.vertical);
  const traversal = direction.vertical === "down" ? layers.slice(1) : layers.slice(0, -1).toReversed();
  for (const layer of traversal) {
    const keys = direction.horizontal === "left" ? layer.nodeKeys : layer.nodeKeys.toReversed();
    for (const key of keys) {
      const neighbors = (adjacent.get(key) || []).toSorted((left, right) => layerOrder.get(left) - layerOrder.get(right));
      if (neighbors.length === 0) continue;
      const middle = direction.horizontal === "left"
        ? neighbors[Math.floor((neighbors.length - 1) / 2)]
        : neighbors[Math.ceil((neighbors.length - 1) / 2)];
      if (!blockRanks.get(Find(parent, key)).has(nodeByKey.get(middle).rank)) {
        Union(parent, key, middle, blockRanks);
      }
    }
  }
  const blocksByRoot = new Map();
  for (const node of proper.nodes) {
    const root = Find(parent, node.key);
    const members = blocksByRoot.get(root) || [];
    members.push(node.key);
    blocksByRoot.set(root, members);
  }
  const initialCenters = BuildInitialCenters(layers, nodeByKey, policy);
  const blockCenters = new Map();
  for (const [root, members] of blocksByRoot) {
    blockCenters.set(root, Median(members.map((key) => initialCenters.get(key))));
  }
  CompactBlocks(blockCenters, blocksByRoot, parent, layers, nodeByKey, policy, direction.horizontal);
  const nodes = proper.nodes.map((node) => Object.freeze({
    key: node.key,
    y: Round(blockCenters.get(Find(parent, node.key)) - node.height / 2)
  }));
  return Object.freeze({
    direction: Object.freeze(direction),
    nodes: Object.freeze(nodes),
    blocks: Object.freeze([...blocksByRoot.values()].map((members) => Object.freeze([...members].sort(CompareText))))
  });
}

function CompactBlocks(blockCenters, blocksByRoot, parent, layers, nodeByKey, policy, horizontal) {
  for (let pass = 0; pass < policy.compactionPasses; pass += 1) {
    let changed = false;
    for (const layer of layers) {
      const keys = horizontal === "left" ? layer.nodeKeys : layer.nodeKeys.toReversed();
      for (let index = 1; index < keys.length; index += 1) {
        const previous = keys[index - 1];
        const current = keys[index];
        const previousRoot = Find(parent, previous);
        const currentRoot = Find(parent, current);
        if (previousRoot === currentRoot) continue;
        const previousNode = nodeByKey.get(previous);
        const currentNode = nodeByKey.get(current);
        const gap = previousNode.dummy || currentNode.dummy ? policy.dummyGap : policy.nodeGap;
        const required = previousNode.height / 2 + gap + currentNode.height / 2;
        const sign = horizontal === "left" ? 1 : -1;
        const actual = sign * (blockCenters.get(currentRoot) - blockCenters.get(previousRoot));
        if (actual + 0.001 >= required) continue;
        blockCenters.set(currentRoot, blockCenters.get(currentRoot) + sign * (required - actual));
        changed = true;
      }
    }
    if (!changed) break;
  }
}

function BuildInitialCenters(layers, nodeByKey, policy) {
  const result = new Map();
  for (const layer of layers) {
    let y = policy.margin;
    for (let index = 0; index < layer.nodeKeys.length; index += 1) {
      const key = layer.nodeKeys[index];
      const node = nodeByKey.get(key);
      result.set(key, y + node.height / 2);
      const nextKey = layer.nodeKeys[index + 1];
      const nextNode = nextKey ? nodeByKey.get(nextKey) : null;
      y += node.height + (node.dummy || nextNode?.dummy ? policy.dummyGap : policy.nodeGap);
    }
  }
  return result;
}

function BuildRankXs(layers, nodeByKey, policy) {
  const result = new Map();
  let x = policy.margin;
  for (const layer of layers) {
    result.set(layer.rank, x);
    const width = Math.max(0, ...layer.nodeKeys.map((key) => nodeByKey.get(key).width));
    x += width + policy.layerGap;
  }
  return result;
}

function BuildAdjacent(segments, vertical) {
  const result = new Map();
  for (const segment of segments) {
    const key = vertical === "down" ? segment.targetKey : segment.sourceKey;
    const neighbor = vertical === "down" ? segment.sourceKey : segment.targetKey;
    const values = result.get(key) || [];
    values.push(neighbor);
    result.set(key, values);
  }
  return result;
}

/**
 * Pushes a layer apart so nothing overlaps.
 *
 * The gap is not uniform: crossing a subtree boundary costs `groupGap` while two
 * nodes inside the same subtree only need `gap`. Without that difference the
 * drawing gives the eye no cue where one tree ends and the next begins.
 */
function ResolveBalancedOverlaps(nodes, layers, gap, dummyGap, groupByNode, groupGap) {
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const groups = groupByNode instanceof Map ? groupByNode : null;
  for (const layer of layers) {
    let bottom = -Infinity;
    let previousGroup = null;
    for (let index = 0; index < layer.nodeKeys.length; index += 1) {
      const key = layer.nodeKeys[index];
      const node = byKey.get(key);
      const previousNode = index > 0 ? byKey.get(layer.nodeKeys[index - 1]) : null;
      let requiredGap = node.dummy || previousNode?.dummy ? dummyGap : gap;
      if (groups && index > 0) {
        const currentGroup = groups.get(key) ?? null;
        if (previousGroup !== null && currentGroup !== previousGroup) {
          requiredGap = Math.max(requiredGap, groupGap);
        }
      }
      if (node.y < bottom + requiredGap) node.y = bottom + requiredGap;
      bottom = node.y + node.height;
      previousGroup = groups ? (groups.get(key) ?? null) : null;
    }
  }
}

function Find(parent, key) {
  let root = key;
  while (parent.get(root) !== root) root = parent.get(root);
  while (parent.get(key) !== key) {
    const next = parent.get(key);
    parent.set(key, root);
    key = next;
  }
  return root;
}

function Union(parent, left, right, blockRanks) {
  const leftRoot = Find(parent, left);
  const rightRoot = Find(parent, right);
  if (leftRoot === rightRoot) return;
  const root = CompareText(leftRoot, rightRoot) <= 0 ? leftRoot : rightRoot;
  const child = leftRoot === root ? rightRoot : leftRoot;
  parent.set(child, root);
  const ranks = blockRanks.get(root);
  for (const rank of blockRanks.get(child)) ranks.add(rank);
  blockRanks.delete(child);
}

function Median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function NormalizePolicy(policy) {
  return {
    layerGap: PositiveNumber(policy.layerGap, DEFAULT_BLOCK_PLACEMENT_POLICY.layerGap),
    nodeGap: PositiveNumber(policy.nodeGap, DEFAULT_BLOCK_PLACEMENT_POLICY.nodeGap),
    dummyGap: PositiveNumber(policy.dummyGap, DEFAULT_BLOCK_PLACEMENT_POLICY.dummyGap),
    groupGap: PositiveNumber(policy.groupGap, DEFAULT_BLOCK_PLACEMENT_POLICY.groupGap),
    margin: Math.max(0, Number(policy.margin) || DEFAULT_BLOCK_PLACEMENT_POLICY.margin),
    compactionPasses: Math.max(1, Math.min(32, Math.floor(Number(policy.compactionPasses) || DEFAULT_BLOCK_PLACEMENT_POLICY.compactionPasses)))
  };
}

function PositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function Round(value) {
  return Math.round(value * 1000) / 1000;
}

function CompareText(left, right) {
  return String(left).localeCompare(String(right));
}
