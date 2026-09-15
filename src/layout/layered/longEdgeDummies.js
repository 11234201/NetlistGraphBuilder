/**
 * Long-edge dummy nodes.
 *
 * A layered drawing is *proper* when every edge connects nodes in adjacent
 * columns. Only then does an edge get a position in every column it crosses,
 * which is what lets a router keep it inside the drawing instead of escaping
 * around it. ELK inserts a chain of dummy nodes for every edge whose span
 * exceeds one layer; this module builds the same chains.
 *
 * Columns, not raw level numbers, are the unit of adjacency here, because
 * `computeLevelXs` allocates an x coordinate only for levels that contain
 * nodes. An edge between two levels with an empty level between them is
 * already adjacent in the drawing.
 *
 * Stage S2a uses the dummies for layer ordering only: they are added to the
 * buckets, ordered, then stripped again before placement. That is the only
 * place where a long edge can influence the column it passes through.
 */

export const DEFAULT_LONG_EDGE_DUMMY_POLICY = Object.freeze({
  // Bounds the dummy count so a pathological graph cannot turn an O(V + E)
  // ordering pass into something much larger. Truncation is canonical: edges
  // are considered in a stable order and an edge that does not fit is left
  // unsplit rather than half split.
  maxDummyNodes: 40000
});

export const LONG_EDGE_DUMMY_LIMITS = Object.freeze({
  maxDummyNodes: Object.freeze([0, 500000])
});

export const DUMMY_NODE_KIND = "layout-dummy";

export function normalizeLongEdgeDummyPolicy(policy = {}) {
  const maximum = Number(policy.maxDummyNodes);
  return {
    maxDummyNodes: Number.isFinite(maximum)
      ? clamp(Math.floor(maximum), ...LONG_EDGE_DUMMY_LIMITS.maxDummyNodes)
      : DEFAULT_LONG_EDGE_DUMMY_POLICY.maxDummyNodes
  };
}

export function isDummyNode(node) {
  return node?.kind === DUMMY_NODE_KIND;
}

/**
 * Builds one dummy per (edge, column) the edge crosses.
 *
 * Ids are topological (`dummy:<realEdgeId>:<level>`), never array indices, so
 * the result does not depend on the order of `graph.edges`.
 */
export function buildLongEdgeChains(graph, levels, policy = {}) {
  const normalized = normalizeLongEdgeDummyPolicy(policy);
  const nodeLevel = new Map();
  for (const [nodeId, level] of levels || []) {
    if (Number.isFinite(level)) nodeLevel.set(nodeId, level);
  }
  const levelKeys = [...new Set(nodeLevel.values())].sort((left, right) => left - right);
  const columnOfLevel = new Map(levelKeys.map((level, index) => [level, index]));

  const dummies = [];
  const dummiesByLevel = new Map(levelKeys.map((level) => [level, []]));
  const chainsByEdge = new Map();
  const orderingEdges = [];
  const diagnostics = [];
  let truncatedEdgeCount = 0;

  const orderedEdges = [...(graph?.edges || [])].toSorted(compareLayeringEdges);
  for (const edge of orderedEdges) {
    const sourceLevel = nodeLevel.get(edge.source);
    const targetLevel = nodeLevel.get(edge.target);
    const sourceColumn = columnOfLevel.get(sourceLevel);
    const targetColumn = columnOfLevel.get(targetLevel);
    // Keep malformed or partially projected edges visible to downstream
    // diagnostics. Dropping them here would make the ordering view silently
    // disagree with the real edge set.
    if (sourceColumn === undefined || targetColumn === undefined) {
      orderingEdges.push(edge);
      continue;
    }
    const columnSpan = targetColumn - sourceColumn;
    // A back edge is a cycle ELK would have broken. It carries no layering
    // constraint and is left to the router.
    if (columnSpan <= 1 || targetLevel - sourceLevel < 1) {
      orderingEdges.push(edge);
      continue;
    }
    const chainLength = columnSpan - 1;
    if (dummies.length + chainLength > normalized.maxDummyNodes) {
      truncatedEdgeCount += 1;
      orderingEdges.push(edge);
      continue;
    }
    const chain = [];
    for (let column = sourceColumn + 1; column < targetColumn; column += 1) {
      const level = levelKeys[column];
      const dummy = {
        id: `dummy:${edge.id}:${level}`,
        kind: DUMMY_NODE_KIND,
        label: "",
        level,
        column,
        realEdgeId: edge.id,
        chainIndex: chain.length,
        chainLength,
        longEdgeSource: edge.source,
        longEdgeTarget: edge.target,
        net: edge.net,
        sourcePin: edge.sourcePin,
        targetPin: edge.targetPin
      };
      chain.push(dummy);
      dummies.push(dummy);
      dummiesByLevel.get(level).push(dummy);
    }
    chainsByEdge.set(edge.id, chain);
    let previous = edge.source;
    chain.forEach((dummy, index) => {
      orderingEdges.push({
        id: `segment:${edge.id}:${index}`,
        source: previous,
        target: dummy.id,
        realEdgeId: edge.id,
        chainIndex: index,
        net: edge.net
      });
      previous = dummy.id;
    });
    orderingEdges.push({
      id: `segment:${edge.id}:${chain.length}`,
      source: previous,
      target: edge.target,
      realEdgeId: edge.id,
      chainIndex: chain.length,
      net: edge.net
    });
  }

  if (truncatedEdgeCount > 0) {
    diagnostics.push({
      code: "layered-dummy-cap-exceeded",
      detail: { truncatedEdgeCount, maxDummyNodes: normalized.maxDummyNodes }
    });
  }

  return {
    dummies,
    dummiesByLevel,
    chainsByEdge,
    orderingEdges,
    levelKeys,
    diagnostics
  };
}

export function addDummyNodesToBuckets(buckets, chains) {
  for (const [level, members] of chains.dummiesByLevel) {
    if (members.length === 0) continue;
    if (!buckets.has(level)) buckets.set(level, []);
    buckets.get(level).push(...members);
  }
  return buckets;
}

/**
 * Records where each dummy ended up inside its column, then removes the
 * dummies from the buckets so nothing downstream ever sees them.
 *
 * The anchor is the pair of real nodes the dummy was ordered between. That
 * pair is the vertical channel the joined edge will travel through, so it has
 * to be captured before the dummy disappears.
 */
export function stripDummyNodes(buckets, chains) {
  const anchors = new Map();
  for (const level of chains.levelKeys) {
    const nodes = buckets.get(level);
    if (!nodes || nodes.length === 0) continue;
    const aboveByIndex = new Array(nodes.length).fill(null);
    const belowByIndex = new Array(nodes.length).fill(null);
    let nearestReal = null;
    for (let index = 0; index < nodes.length; index += 1) {
      if (isDummyNode(nodes[index])) aboveByIndex[index] = nearestReal;
      else nearestReal = nodes[index];
    }
    nearestReal = null;
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      if (isDummyNode(nodes[index])) belowByIndex[index] = nearestReal;
      else nearestReal = nodes[index];
    }
    for (let index = 0; index < nodes.length; index += 1) {
      if (!isDummyNode(nodes[index])) continue;
      const above = aboveByIndex[index];
      const below = belowByIndex[index];
      anchors.set(nodes[index].id, {
        level,
        column: nodes[index].column,
        aboveId: above?.id || null,
        belowId: below?.id || null,
        realEdgeId: nodes[index].realEdgeId
      });
    }
    buckets.set(level, nodes.filter((node) => !isDummyNode(node)));
  }
  return anchors;
}

export function summarizeLongEdgeChains(chains) {
  const spanHistogram = new Map();
  for (const chain of chains.chainsByEdge.values()) {
    const span = chain.length + 1;
    spanHistogram.set(span, (spanHistogram.get(span) || 0) + 1);
  }
  return {
    dummyCount: chains.dummies.length,
    splitEdgeCount: chains.chainsByEdge.size,
    orderingEdgeCount: chains.orderingEdges.length,
    spanHistogram: [...spanHistogram.entries()].sort((left, right) => left[0] - right[0]),
    diagnostics: chains.diagnostics.map((entry) => entry.code)
  };
}

function compareLayeringEdges(left, right) {
  return compareIds(left.source, right.source) ||
    compareIds(left.target, right.target) ||
    compareIds(left.id, right.id);
}

function compareIds(left, right) {
  return String(left || "").localeCompare(String(right || ""));
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
