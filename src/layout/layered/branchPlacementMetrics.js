import { round } from "../nodePlacementShared.js";

/**
 * Measure repeated controlled sinks (for example a DFF bank with shared
 * clock/reset trunks) without relying on cell type or fixture identity.
 * The metric is diagnostic: placement uses the resulting primary data parent
 * in a later stage, while this boundary freezes the visual baseline first.
 */
export function summarizeControlledSinkSpacing(nodes, edges, {
  sharedSourceFanout = 16,
  primarySourceFanout = 4,
  largeGapFactor = 2
} = {}) {
  const sinks = collectControlledSinks(nodes, edges, {
    sharedSourceFanout,
    primarySourceFanout
  });
  const columns = groupByColumn(sinks).map((entries) => summarizeColumn(entries, largeGapFactor));
  return Object.freeze({
    sinkCount: sinks.length,
    columnCount: columns.length,
    columns: Object.freeze(columns),
    largeGapCount: columns.reduce((sum, column) => sum + column.largeGapCount, 0),
    maximumGap: round(Math.max(0, ...columns.map((column) => column.maximumGap))),
    meanPrimaryAlignmentError: round(mean(sinks.map(({ node, primaryNode }) =>
      primaryNode ? Math.abs(centerY(node) - centerY(primaryNode)) : 0)))
  });
}

export function collectControlledSinks(nodes, edges, {
  sharedSourceFanout = 16,
  primarySourceFanout = 4
} = {}) {
  const nodeById = new Map((nodes || []).map((node) => [node.id, node]));
  const incoming = new Map();
  const fanout = new Map();
  for (const edge of stableEdges(edges)) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    if (!incoming.has(edge.target)) incoming.set(edge.target, []);
    incoming.get(edge.target).push(edge);
    fanout.set(edge.source, (fanout.get(edge.source) || 0) + 1);
  }

  const sinks = [];
  for (const node of [...nodeById.values()].sort(compareIdsByNode)) {
    const links = incoming.get(node.id) || [];
    const hasSharedControl = links.some((edge) =>
      (fanout.get(edge.source) || 0) >= sharedSourceFanout);
    const primaryEdges = links.filter((edge) =>
      (fanout.get(edge.source) || 0) <= primarySourceFanout);
    if (!hasSharedControl || primaryEdges.length === 0) continue;
    const primary = primaryEdges.toSorted((left, right) =>
      (fanout.get(left.source) || 0) - (fanout.get(right.source) || 0) ||
      compareEdges(left, right))[0];
    sinks.push({ node, primary, primaryNode: nodeById.get(primary.source) });
  }

  return sinks;
}

function groupByColumn(sinks) {
  const groups = new Map();
  for (const entry of sinks) {
    const key = Number.isFinite(Number(entry.node.level))
      ? `level:${entry.node.level}`
      : `x:${round(Number(entry.node.x) || 0)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return [...groups.values()]
    .filter((entries) => entries.length >= 2)
    .sort((left, right) =>
      (Number(left[0].node.x) || 0) - (Number(right[0].node.x) || 0) ||
      compareIdsByNode(left[0].node, right[0].node));
}

function summarizeColumn(entries, largeGapFactor) {
  const ordered = entries.toSorted((left, right) =>
    Number(left.node.y) - Number(right.node.y) || compareIdsByNode(left.node, right.node));
  const gapEntries = [];
  for (let index = 1; index < ordered.length; index += 1) {
    gapEntries.push({
      afterNodeId: ordered[index - 1].node.id,
      beforeNodeId: ordered[index].node.id,
      gap: Math.max(0,
        Number(ordered[index].node.y) -
        (Number(ordered[index - 1].node.y) + Number(ordered[index - 1].node.height)))
    });
  }
  const gaps = gapEntries.map((entry) => entry.gap);
  const minimumGap = Math.min(...gaps);
  const threshold = Math.max(minimumGap + 1, minimumGap * largeGapFactor);
  const largeGaps = gapEntries
    .filter((entry) => entry.gap >= threshold)
    .map((entry) => Object.freeze({ ...entry, gap: round(entry.gap) }));
  return Object.freeze({
    x: round(Number(ordered[0].node.x) || 0),
    level: Number.isFinite(Number(ordered[0].node.level)) ? Number(ordered[0].node.level) : null,
    sinkCount: ordered.length,
    minimumGap: round(minimumGap),
    medianGap: round(median(gaps)),
    maximumGap: round(Math.max(...gaps)),
    largeGapThreshold: round(threshold),
    largeGapCount: largeGaps.length,
    largeGaps: Object.freeze(largeGaps),
    largeGapRatio: round(largeGaps.length / gaps.length),
    gapCoefficientOfVariation: round(coefficientOfVariation(gaps)),
    primaryOrderAgreement: round(orderAgreement(ordered))
  });
}

function orderAgreement(ordered) {
  if (ordered.length < 2) return 1;
  const byParent = ordered.toSorted((left, right) =>
    centerY(left.primaryNode) - centerY(right.primaryNode) ||
    compareIdsByNode(left.node, right.node));
  const rank = new Map(byParent.map((entry, index) => [entry.node.id, index]));
  let concordant = 0;
  let pairs = 0;
  for (let left = 0; left < ordered.length; left += 1) {
    for (let right = left + 1; right < ordered.length; right += 1) {
      pairs += 1;
      if (rank.get(ordered[left].node.id) < rank.get(ordered[right].node.id)) concordant += 1;
    }
  }
  return pairs > 0 ? concordant / pairs : 1;
}

function coefficientOfVariation(values) {
  const average = mean(values);
  if (average <= 0) return 0;
  const variance = mean(values.map((value) => (value - average) ** 2));
  return Math.sqrt(variance) / average;
}

function centerY(node) {
  if (!node) return 0;
  return Number(node.y) + Number(node.height) / 2;
}

function mean(values) {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function median(values) {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

function stableEdges(edges) {
  return [...(edges || [])].sort(compareEdges);
}

function compareEdges(left, right) {
  return String(left.source).localeCompare(String(right.source)) ||
    String(left.target).localeCompare(String(right.target)) ||
    String(left.sourcePin || "").localeCompare(String(right.sourcePin || "")) ||
    String(left.targetPin || "").localeCompare(String(right.targetPin || "")) ||
    String(left.id || "").localeCompare(String(right.id || ""));
}

function compareIdsByNode(left, right) {
  return String(left?.id || "").localeCompare(String(right?.id || ""));
}
