import { groupNodesByLevel, round } from "../nodePlacementShared.js";
import { DEFAULT_LAYOUT_POLICY } from "../layoutPolicy.js";
import {
  collectControlledSinks,
  summarizeControlledSinkSpacing
} from "./branchPlacementMetrics.js";
import { compactOrderedLayer, summarizePlacement } from "./balancedPlacement.js";

/**
 * Propagate low-fanout data-flow spacing through banks that also share one or
 * more high-fanout controls. This creates multi-layer branch bands: the data
 * parent owns the target row while shared clock/reset-like trunks do not pull
 * every target back into one minimum-gap stack.
 */
export function applyControlledSinkBranchPlacement(nodes, edges, levelKeys, {
  minimumY = 0,
  gap = 8,
  sharedSourceFanout = 16,
  primarySourceFanout = 4,
  branchBandSize = DEFAULT_LAYOUT_POLICY.spacing.branchBandSize,
  branchBandGap = DEFAULT_LAYOUT_POLICY.spacing.branchBandGap,
  branchCenterGap = DEFAULT_LAYOUT_POLICY.spacing.branchCenterGap
} = {}) {
  const nodeById = new Map((nodes || []).map((node) => [node.id, node]));
  const sinks = collectControlledSinks(nodes, edges, {
    sharedSourceFanout,
    primarySourceFanout
  });
  const sinkById = new Map(sinks.map((entry) => [entry.node.id, entry]));
  const nodesByLevel = groupNodesByLevel(nodes);
  let movedNodeCount = 0;

  for (const level of levelKeys || []) {
    const layer = (nodesByLevel.get(level) || []).toSorted(comparePlacedNodes);
    if (layer.length < 2 || !layer.some((node) => sinkById.has(node.id))) continue;
    const preferred = layer.map((node) => {
      const entry = sinkById.get(node.id);
      if (!entry?.primaryNode) return node.y;
      return centerY(entry.primaryNode) - Number(node.height) / 2;
    });
    const originalCenter = layerCenter(layer, layer.map((node) => Number(node.y)));
    const positions = compactOrderedLayer(layer, preferred, minimumY, gap);
    distributeBranchBandWhitespace(layer, positions, sinkById, {
      branchBandSize,
      branchBandGap,
      branchCenterGap
    });
    preserveLayerCenter(layer, positions, originalCenter, minimumY);
    for (let index = 0; index < layer.length; index += 1) {
      if (Math.abs(Number(layer[index].y) - positions[index]) > 0.001) movedNodeCount += 1;
      layer[index].y = round(positions[index]);
    }
  }
  return Object.freeze({ sinkCount: sinks.length, movedNodeCount });
}

function preserveLayerCenter(layer, positions, originalCenter, minimumY) {
  const newCenter = layerCenter(layer, positions);
  const requestedShift = originalCenter - newCenter;
  const minimumPosition = Math.min(...positions);
  const shift = Math.max(requestedShift, minimumY - minimumPosition);
  if (Math.abs(shift) <= 0.001) return;
  for (let index = 0; index < positions.length; index += 1) {
    positions[index] = round(positions[index] + shift);
  }
}

function layerCenter(layer, positions) {
  if (layer.length === 0) return 0;
  const top = Math.min(...positions);
  const bottom = Math.max(...positions.map((position, index) =>
    position + Number(layer[index].height)));
  return (top + bottom) / 2;
}

/** Align the focused root's single-forward path with the first high-fanout
 * branch source. Nodes on the path may change their row within a layer; this
 * is what prevents a stable-id-first root from remaining pinned to the top of
 * an otherwise centered diagram. */
export function alignFocusedRootSpine(nodes, edges, levelKeys, {
  minimumY = 0,
  gap = 8,
  maximumDepth = 6
} = {}) {
  const nodeById = new Map((nodes || []).map((node) => [node.id, node]));
  const outgoing = new Map();
  for (const edge of [...(edges || [])].sort(compareEdges)) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    outgoing.get(edge.source).push(edge);
  }
  const layers = groupNodesByLevel(nodes);
  let movedNodeCount = 0;
  let pathCount = 0;
  for (const root of [...nodeById.values()].filter((node) => node.isFocusedRoot === true)
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))) {
    const path = [root];
    let cursor = root;
    for (let depth = 0; depth < maximumDepth; depth += 1) {
      const candidates = (outgoing.get(cursor.id) || [])
        .map((edge) => nodeById.get(edge.target))
        .filter((target) => target && Number(target.level) > Number(cursor.level))
        .sort((left, right) =>
          (outgoing.get(right.id)?.length || 0) - (outgoing.get(left.id)?.length || 0) ||
          String(left.id).localeCompare(String(right.id)));
      if (candidates.length === 0) break;
      cursor = candidates[0];
      path.push(cursor);
      if ((outgoing.get(cursor.id)?.length || 0) >= 8 || cursor.kind === "hub") break;
    }
    if (path.length < 2) continue;
    const anchor = path[path.length - 1];
    if ((outgoing.get(anchor.id)?.length || 0) < 8 && anchor.kind !== "hub") continue;
    const anchorCenter = centerY(anchor);
    pathCount += 1;
    for (const member of path.slice(0, -1)) {
      const layer = [...(layers.get(member.level) || [])]
        .filter((node) => node.id !== member.id)
        .sort(comparePlacedNodes);
      const insertion = layer.findIndex((node) => centerY(node) > anchorCenter);
      layer.splice(insertion < 0 ? layer.length : insertion, 0, member);
      const preferred = layer.map((node) =>
        node.id === member.id ? anchorCenter - Number(node.height) / 2 : Number(node.y));
      const positions = compactOrderedLayer(layer, preferred, minimumY, gap);
      for (let index = 0; index < layer.length; index += 1) {
        if (Math.abs(Number(layer[index].y) - positions[index]) > 0.001) movedNodeCount += 1;
        layer[index].y = round(positions[index]);
      }
    }
  }
  return Object.freeze({ pathCount, movedNodeCount });
}

export function alignFocusedBranchBlock(nodes, edges, levelKeys, {
  minimumY = 0,
  gap = 8,
  faninDepth = 3,
  fanoutDepth = 6,
  targetCenter = null
} = {}) {
  const nodeById = new Map((nodes || []).map((node) => [node.id, node]));
  const incoming = new Map();
  const outgoing = new Map();
  for (const edge of [...(edges || [])].sort(compareEdges)) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    if (!incoming.has(edge.target)) incoming.set(edge.target, []);
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    incoming.get(edge.target).push(edge);
    outgoing.get(edge.source).push(edge);
  }
  const selected = new Set();
  const anchors = [];
  for (const root of [...nodeById.values()].filter((node) => node.isFocusedRoot === true)
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))) {
    selected.add(root.id);
    let frontier = [root.id];
    for (let depth = 0; depth < faninDepth; depth += 1) {
      const next = [];
      for (const id of frontier) {
        for (const edge of incoming.get(id) || []) {
          if (selected.has(edge.source)) continue;
          selected.add(edge.source);
          next.push(edge.source);
        }
      }
      frontier = next.sort((left, right) => String(left).localeCompare(String(right)));
    }
    let cursor = root;
    for (let depth = 0; depth < fanoutDepth; depth += 1) {
      const candidates = (outgoing.get(cursor.id) || [])
        .map((edge) => nodeById.get(edge.target))
        .filter((target) => target && Number(target.level) > Number(cursor.level))
        .sort((left, right) =>
          (outgoing.get(right.id)?.length || 0) - (outgoing.get(left.id)?.length || 0) ||
          String(left.id).localeCompare(String(right.id)));
      if (candidates.length === 0) break;
      cursor = candidates[0];
      selected.add(cursor.id);
      if ((outgoing.get(cursor.id)?.length || 0) >= 8 || cursor.kind === "hub") {
        anchors.push(cursor);
        break;
      }
    }
  }
  if (anchors.length === 0 || selected.size === 0) {
    return Object.freeze({ blockCount: 0, selectedNodeCount: selected.size, movedNodeCount: 0 });
  }
  const anchorCenter = targetCenter !== null && Number.isFinite(Number(targetCenter))
    ? Number(targetCenter)
    : median(anchors.map(centerY).sort((left, right) => left - right));
  const layers = groupNodesByLevel(nodes);
  let movedNodeCount = 0;
  for (const level of levelKeys || []) {
    const layer = [...(layers.get(level) || [])].sort(comparePlacedNodes);
    const members = layer.filter((node) => selected.has(node.id) && !anchors.includes(node));
    if (members.length === 0) continue;
    const others = layer.filter((node) => !members.includes(node));
    const groupHeight = members.reduce((sum, node) => sum + Number(node.height), 0) +
      Math.max(0, members.length - 1) * gap;
    let nextMemberY = anchorCenter - groupHeight / 2;
    const desired = new Map();
    for (const member of members) {
      desired.set(member.id, nextMemberY);
      nextMemberY += Number(member.height) + gap;
    }
    const ordered = [...others, ...members].sort((left, right) =>
      (desired.get(left.id) ?? Number(left.y)) - (desired.get(right.id) ?? Number(right.y)) ||
      String(left.id).localeCompare(String(right.id)));
    const preferred = ordered.map((node) => desired.get(node.id) ?? Number(node.y));
    const positions = compactOrderedLayer(ordered, preferred, minimumY, gap);
    for (let index = 0; index < ordered.length; index += 1) {
      if (Math.abs(Number(ordered[index].y) - positions[index]) > 0.001) movedNodeCount += 1;
      ordered[index].y = round(positions[index]);
    }
  }
  return Object.freeze({
    blockCount: anchors.length,
    selectedNodeCount: selected.size,
    movedNodeCount
  });
}

/** Return the shared visual axis of large controlled-sink banks. The value is
 * derived from topology-selected sink columns, never from fixture identities. */
export function findControlledSinkBankCenter(nodes, edges, {
  minimumBankSize = 32,
  sharedSourceFanout = 16,
  primarySourceFanout = 4
} = {}) {
  const sinks = collectControlledSinks(nodes, edges, {
    sharedSourceFanout,
    primarySourceFanout
  });
  const byLevel = new Map();
  for (const { node } of sinks) {
    const level = Number(node.level);
    if (!Number.isFinite(level)) continue;
    const column = byLevel.get(level) || [];
    column.push(node);
    byLevel.set(level, column);
  }
  const centers = [...byLevel.values()]
    .filter((column) => column.length >= minimumBankSize)
    .map((column) => {
      const ordered = column.toSorted(comparePlacedNodes);
      const lower = ordered[Math.floor((ordered.length - 1) / 2)];
      const upper = ordered[Math.ceil((ordered.length - 1) / 2)];
      return (centerY(lower) + centerY(upper)) / 2;
    })
    .sort((left, right) => left - right);
  return centers.length > 0 ? median(centers) : null;
}

/** Centre every intermediate layer as one rigid row-ordered block on the
 * controlled-bank axis. Unlike moving a selected fanin subset, this keeps all
 * intra-layer offsets and therefore cannot introduce a new order crossing. */
export function centerFocusedCoreLayers(nodes, edges, levelKeys, {
  minimumY = 0,
  minimumBankSize = 32
} = {}) {
  const bankCenter = findControlledSinkBankCenter(nodes, edges, { minimumBankSize });
  if (!Number.isFinite(bankCenter)) return Object.freeze({ layerCount: 0, movedNodeCount: 0 });
  const sinks = collectControlledSinks(nodes, edges);
  const sinkCountsByLevel = new Map();
  for (const { node } of sinks) {
    const level = Number(node.level);
    sinkCountsByLevel.set(level, (sinkCountsByLevel.get(level) || 0) + 1);
  }
  const bankLevels = [...sinkCountsByLevel]
    .filter(([, count]) => count >= minimumBankSize)
    .map(([level]) => level);
  if (bankLevels.length === 0) return Object.freeze({ layerCount: 0, movedNodeCount: 0 });
  const firstBankLevel = Math.min(...bankLevels);
  const layers = groupNodesByLevel(nodes);
  let layerCount = 0;
  let movedNodeCount = 0;
  for (const level of levelKeys || []) {
    if (Number(level) <= 0 || Number(level) >= firstBankLevel) continue;
    const layer = layers.get(level) || [];
    if (layer.length === 0) continue;
    const top = Math.min(...layer.map((node) => Number(node.y)));
    const bottom = Math.max(...layer.map((node) => Number(node.y) + Number(node.height)));
    const shift = Math.max(minimumY - top, bankCenter - (top + bottom) / 2);
    if (Math.abs(shift) <= 0.001) continue;
    layerCount += 1;
    movedNodeCount += layer.length;
    for (const node of layer) node.y = round(Number(node.y) + shift);
  }
  return Object.freeze({ layerCount, movedNodeCount, bankCenter, firstBankLevel });
}

function distributeBranchBandWhitespace(layer, positions, sinkById, {
  branchBandSize,
  branchBandGap,
  branchCenterGap
}) {
  const bandSize = Math.max(2, Math.floor(Number(branchBandSize)));
  const bandGap = Math.max(0, Number(branchBandGap) || 0);
  if (bandGap <= 0) return;
  let controlledCount = 0;
  let previousControlledIndex = -1;
  const controlledTotal = layer.filter((node) => sinkById.has(node.id)).length;
  const centerBoundary = controlledTotal >= bandSize * 2 ? Math.floor(controlledTotal / 2) : -1;
  for (let index = 0; index < layer.length; index += 1) {
    if (!sinkById.has(layer[index].id)) continue;
    if (controlledCount > 0 &&
        (controlledCount % bandSize === 0 || controlledCount === centerBoundary)) {
      const previous = layer[previousControlledIndex];
      const currentGap = positions[index] -
        (positions[previousControlledIndex] + Number(previous.height));
      const requestedGap = controlledCount === centerBoundary
        ? Math.max(bandGap, Number(branchCenterGap) || 0)
        : bandGap;
      const shift = Math.max(0, requestedGap - currentGap);
      if (shift > 0) {
        for (let suffix = index; suffix < positions.length; suffix += 1) {
          positions[suffix] = round(positions[suffix] + shift);
        }
      }
    }
    previousControlledIndex = index;
    controlledCount += 1;
  }
}

export function chooseControlledBranchPlacement(baseNodes, candidateNodes, edges, {
  maximumHeightGrowth = 1.25,
  minimumAlignmentImprovement = 0.2,
  sharedSourceFanout = 16,
  primarySourceFanout = 4
} = {}) {
  const metricOptions = { sharedSourceFanout, primarySourceFanout };
  const base = summarizeBranchPlacement(baseNodes, edges, metricOptions);
  const candidate = summarizeBranchPlacement(candidateNodes, edges, metricOptions);
  const heightLimit = Math.max(base.placement.height, base.placement.height * maximumHeightGrowth);
  const requiredAlignment = base.controlled.meanPrimaryAlignmentError *
    (1 - minimumAlignmentImprovement);
  const validPopulation = candidate.controlled.sinkCount === base.controlled.sinkCount &&
    candidate.controlled.sinkCount > 0;
  const alignmentImproved = candidate.controlled.meanPrimaryAlignmentError <= requiredAlignment;
  const branchWhitespaceImproved = candidate.controlled.largeGapCount > base.controlled.largeGapCount ||
    candidate.controlled.maximumGap > base.controlled.maximumGap;
  const boundedHeight = candidate.placement.height <= heightLimit;
  const selected = validPopulation && alignmentImproved && branchWhitespaceImproved && boundedHeight;
  return Object.freeze({
    nodes: selected ? candidateNodes : baseNodes,
    selected,
    reason: !validPopulation ? "controlled-sink-population-mismatch"
      : !alignmentImproved ? "primary-alignment-not-improved"
        : !branchWhitespaceImproved ? "branch-whitespace-not-improved"
          : !boundedHeight ? "height-growth-limit" : "branch-structure-improved",
    base,
    candidate
  });
}

function summarizeBranchPlacement(nodes, edges, metricOptions) {
  return Object.freeze({
    placement: Object.freeze(summarizePlacement(nodes, edges)),
    controlled: summarizeControlledSinkSpacing(nodes, edges, metricOptions)
  });
}

function comparePlacedNodes(left, right) {
  return Number(left.y) - Number(right.y) || String(left.id).localeCompare(String(right.id));
}

function centerY(node) {
  return Number(node.y) + Number(node.height) / 2;
}

function median(values) {
  if (values.length === 0) return 0;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 1
    ? values[middle]
    : (values[middle - 1] + values[middle]) / 2;
}

function compareEdges(left, right) {
  return String(left.source).localeCompare(String(right.source)) ||
    String(left.target).localeCompare(String(right.target)) ||
    String(left.id || "").localeCompare(String(right.id || ""));
}
