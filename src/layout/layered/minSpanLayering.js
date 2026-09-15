import { compareNodes, isExternalSourceNode } from "../nodePlacementShared.js";

/**
 * Deterministic bounded improvement over source-anchored longest-path ranking.
 *
 * Longest-path ranking and minimal-total-span ranking disagree wherever a
 * node's layer is constrained from the successor side. A boundary input that
 * feeds a deep cell sits at layer 0 under longest path and directly left of
 * that cell under minimal span. The latter is what ELK's network simplex
 * produces and it is what keeps long edges from crossing the whole drawing.
 */

export const DEFAULT_MINIMAL_SPAN_POLICY = Object.freeze({
  relaxationSweeps: 8,
  boundaryAnchor: "constrained",
  // A primary port is a port of the module itself, so a schematic keeps it on
  // the leading or trailing edge instead of the middle of the datapath. Only
  // the boundary nodes a Focused query synthesized are free to move.
  anchorPrimaryPorts: true
});

export const MINIMAL_SPAN_LIMITS = Object.freeze({
  relaxationSweeps: Object.freeze([0, 64])
});

export function normalizeMinimalSpanPolicy(policy = {}) {
  const sweeps = Number(policy.relaxationSweeps);
  return {
    relaxationSweeps: Number.isFinite(sweeps)
      ? clamp(
        Math.floor(sweeps),
        MINIMAL_SPAN_LIMITS.relaxationSweeps[0],
        MINIMAL_SPAN_LIMITS.relaxationSweeps[1]
      )
      : DEFAULT_MINIMAL_SPAN_POLICY.relaxationSweeps,
    boundaryAnchor: policy.boundaryAnchor === "source"
      ? "source"
      : DEFAULT_MINIMAL_SPAN_POLICY.boundaryAnchor,
    anchorPrimaryPorts: policy.anchorPrimaryPorts !== false
  };
}

/**
 * Reduces `sum(weight * (level(target) - level(source)))` over the edges
 * already satisfied by `initialLevels`, subject to
 * `level(target) - level(source) >= 1`.
 *
 * The objective is linear in each single level, so the best value for a node
 * is always an endpoint of its currently feasible interval. Each accepted move
 * strictly decreases the objective, so the sweep terminates. This is coordinate
 * descent and does not claim the global optimum of network simplex. Traversal
 * order is derived from `(level, node key)` only, which makes the result
 * independent of node and edge array order.
 */
export function relaxToMinimalSpan(graph, initialLevels, policy = {}) {
  const normalized = normalizeMinimalSpanPolicy(policy);
  const nodes = [...(graph?.nodes || [])].toSorted(compareNodes);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const levels = new Map();
  for (const node of nodes) {
    const initial = Number(initialLevels?.get(node.id));
    levels.set(node.id, Number.isFinite(initial) ? Math.round(initial) : 0);
  }

  const incoming = new Map(nodes.map((node) => [node.id, []]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  const orderedEdges = [...(graph?.edges || [])].toSorted(compareLayeringEdges);
  for (const edge of orderedEdges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    // An edge the initial ranking could not satisfy belongs to a broken cycle.
    // It carries no layering constraint and is handled by routing.
    if (levels.get(edge.target) - levels.get(edge.source) < 1) continue;
    const weight = readWeight(edge);
    outgoing.get(edge.source).push({ other: edge.target, weight });
    incoming.get(edge.target).push({ other: edge.source, weight });
  }

  const movable = nodes.filter((node) => isMovableLayerNode(node, normalized));

  for (let sweep = 0; sweep < normalized.relaxationSweeps; sweep += 1) {
    // Descending sweeps settle the upper bound before a source is pulled
    // right; ascending sweeps settle the lower bound before a sink is pulled
    // left. Alternating both keeps convergence bounded and order-independent.
    const descending = sweep % 2 === 0;
    const order = [...movable].sort((left, right) => {
      const difference = levels.get(left.id) - levels.get(right.id);
      return (descending ? -difference : difference) || compareNodes(left, right);
    });
    let moved = false;
    for (const node of order) {
      const current = levels.get(node.id);
      const ins = incoming.get(node.id);
      const outs = outgoing.get(node.id);
      let lower = current;
      let upper = current;
      let weightIn = 0;
      let weightOut = 0;
      if (ins.length > 0) {
        lower = -Infinity;
        for (const link of ins) {
          lower = Math.max(lower, levels.get(link.other) + 1);
          weightIn += link.weight;
        }
      }
      if (outs.length > 0) {
        upper = Infinity;
        for (const link of outs) {
          upper = Math.min(upper, levels.get(link.other) - 1);
          weightOut += link.weight;
        }
      }
      if (weightIn > weightOut && current > lower) {
        levels.set(node.id, lower);
        moved = true;
      } else if (weightIn < weightOut && current < upper) {
        levels.set(node.id, upper);
        moved = true;
      }
    }
    if (!moved) break;
  }

  return shiftToOrigin(levels);
}

export function summarizeLayerSpans(graph, levels) {
  const histogram = new Map();
  let totalSpan = 0;
  let counted = 0;
  let multiLayer = 0;
  for (const edge of graph?.edges || []) {
    const source = levels?.get(edge.source);
    const target = levels?.get(edge.target);
    if (!Number.isFinite(source) || !Number.isFinite(target)) continue;
    const span = target - source;
    counted += 1;
    totalSpan += span;
    if (span > 1) multiLayer += 1;
    histogram.set(span, (histogram.get(span) || 0) + 1);
  }
  const layerCounts = new Map();
  for (const level of levels?.values() || []) {
    layerCounts.set(level, (layerCounts.get(level) || 0) + 1);
  }
  return {
    edgeCount: counted,
    totalEdgeSpan: totalSpan,
    averageEdgeSpan: counted > 0 ? round(totalSpan / counted) : 0,
    multiLayerEdgeCount: multiLayer,
    multiLayerEdgeRatio: counted > 0 ? round(multiLayer / counted) : 0,
    layerCount: layerCounts.size,
    nodesPerLayer: [...layerCounts.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([, count]) => count),
    spanHistogram: [...histogram.entries()].sort((left, right) => left[0] - right[0])
  };
}

function isMovableLayerNode(node, policy) {
  if (policy.anchorPrimaryPorts && isPrimaryPort(node)) return false;
  if (policy.boundaryAnchor === "source" && isExternalSourceNode(node)) return false;
  return true;
}

function isPrimaryPort(node) {
  return node.kind === "input" || node.kind === "output";
}

function compareLayeringEdges(left, right) {
  return compareIds(left.source, right.source) ||
    compareIds(left.target, right.target) ||
    compareIds(left.id, right.id);
}

function compareIds(left, right) {
  return String(left || "").localeCompare(String(right || ""));
}

function readWeight(edge) {
  const weight = Number(edge?.priorityShortness);
  return Number.isFinite(weight) && weight > 0 ? weight : 1;
}

function shiftToOrigin(levels) {
  let minimum = Infinity;
  for (const value of levels.values()) minimum = Math.min(minimum, value);
  if (!Number.isFinite(minimum)) return levels;
  if (minimum !== 0) {
    for (const [key, value] of levels) levels.set(key, value - minimum);
  }
  return levels;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
