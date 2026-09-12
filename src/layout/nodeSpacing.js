import {
  compareNodes,
  findNearestFreeY,
  groupNodesByLevel,
  isExternalSourceNode,
  isOutputNode,
  round,
  stackNodesVertically
} from "./nodePlacementShared.js";
import { MAX_LOCALIZED_INPUT_LOADS } from "./nodeLocality.js";
import { getConnectionPoint, getPort } from "./nodeGeometry.js";
import { createNodeSpatialIndex } from "./spatialIndex.js";

const MAX_GROUP_ESCAPE_SHIFTS = 8;
const MAX_SOURCE_ESCAPE_PASSES = 1;

export function resolveExternalSourceOverlaps(nodes, margin, gap = 8) {
  const sources = nodes
    .filter(isExternalSourceNode)
    .toSorted((left, right) => left.y - right.y || compareNodes(left, right));
  stackNodesVertically(sources, margin, gap);
}

/**
 * Resolve only actual source-body intersections after a locality pass.
 *
 * The regular source sweep also restores the requested visual gap, which can
 * move an otherwise intentional branch lane. A post-locality pass should be
 * a minimal repair: change a source only when it overlaps another visible
 * node, while preserving the target-aligned x position from locality.
 */
export function resolvePostLocalitySourceOverlaps(nodes, margin, gap = 0) {
  const sources = nodes
    .filter(isExternalSourceNode)
    .toSorted((left, right) => left.y - right.y || compareNodes(left, right));
  for (const source of sources) {
    const blockers = nodes.filter((candidate) =>
      candidate.id !== source.id &&
      horizontalRangesOverlap(source, candidate, gap) &&
      verticalRangesOverlap(source, candidate, gap)
    );
    if (blockers.length > 0) {
      source.y = findNearestFreeY(source, source.y, nodes, new Set([source.id]), margin, gap);
    }
  }
}

/**
 * Keep the mandatory first horizontal escape from an external source clear.
 * Locality can place a different input between a source pin and its target;
 * body-overlap repair cannot see that line-of-sight blockage. Query the node
 * index once and move only the blocked source to the nearest clear pin row.
 */
export function resolveExternalSourceEscapeOverlaps(nodes, edges, margin, gap = 8) {
  if (!nodes?.length || !edges?.length) return;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map();
  for (const edge of edges) {
    const entries = outgoing.get(edge.source) || [];
    entries.push(edge);
    outgoing.set(edge.source, entries);
  }
  for (let pass = 0; pass < MAX_SOURCE_ESCAPE_PASSES; pass += 1) {
    const nodeIndex = createNodeSpatialIndex(nodes);
    const sources = nodes
      .filter(isExternalSourceNode)
      .toSorted((left, right) => left.y - right.y || compareNodes(left, right));
    let moved = 0;
    for (const source of sources) {
      const blockers = [];
      const sourceEdges = (outgoing.get(source.id) || [])
        .toSorted((left, right) => String(left.id || "").localeCompare(String(right.id || "")));
      for (const edge of sourceEdges) {
        const target = nodeById.get(edge.target);
        // Ordinary cell routes already have a compact obstacle search and may
        // intentionally rely on fixed node overrides. This placement repair
        // belongs to collapsed boundary corridors, where a wide group target
        // can otherwise make every legal target-side vertical lane unavailable.
        if (target?.kind !== "group") continue;
        const sourcePoint = getConnectionPoint(source, edge.sourcePin, "source");
        const targetPoint = getConnectionPoint(target, edge.targetPin, "target");
        const side = getPort(source, edge.sourcePin, "source")?.side || "right";
        const forward = side === "right" && targetPoint.x > sourcePoint.x;
        const reverse = side === "left" && targetPoint.x < sourcePoint.x;
        if (!forward && !reverse) continue;
        const left = Math.min(sourcePoint.x, targetPoint.x);
        const right = Math.max(sourcePoint.x, targetPoint.x);
        for (const candidate of nodeIndex.query({
          left,
          right,
          top: sourcePoint.y - 0.01,
          bottom: sourcePoint.y + 0.01
        })) {
          if (candidate.id === source.id || candidate.id === target.id) continue;
          if (!(sourcePoint.y > candidate.y && sourcePoint.y < candidate.y + candidate.height)) continue;
          if (!(right > candidate.x && left < candidate.x + candidate.width)) continue;
          blockers.push({ candidate, sourcePoint });
        }
      }
      if (blockers.length === 0) continue;
      blockers.sort((left, right) =>
        Math.abs(left.candidate.x - left.sourcePoint.x) -
          Math.abs(right.candidate.x - right.sourcePoint.x) ||
        String(left.candidate.id).localeCompare(String(right.candidate.id)));
      const { candidate: blocker, sourcePoint } = blockers[0];
      const portOffset = sourcePoint.y - source.y;
      const below = blocker.y + blocker.height + gap - portOffset;
      const above = blocker.y - gap - portOffset;
      const preferredY = Math.abs(above - source.y) <= Math.abs(below - source.y) ? above : below;
      const nextY = findNearestFreeY(source, preferredY, nodes, new Set([source.id]), margin, gap);
      if (Math.abs(nextY - source.y) < 0.01) continue;
      source.y = nextY;
      moved += 1;
    }
    if (moved === 0) break;
  }
}

export function resolveLevelOverlaps(
  nodes,
  levelKeys,
  margin,
  gap = 16,
  layoutIntent = null,
  fanoutGap = gap,
  nodesByLevel = groupNodesByLevel(nodes),
  cellSpacing = gap
) {
  const primaryChainTargets = getPrimaryCellChainTargets(layoutIntent);
  for (const level of levelKeys) {
    const levelNodes = (nodesByLevel.get(level) || [])
      .toSorted((left, right) => left.y - right.y || compareNodes(left, right));
    const anchoredNodes = levelNodes.filter((node) => primaryChainTargets.has(node.id));
    if (anchoredNodes.length > 0) {
      resolveLevelAroundPrimaryChain(levelNodes, anchoredNodes, margin, gap, layoutIntent, fanoutGap, cellSpacing);
      continue;
    }

    let nextY = margin;
    for (const node of levelNodes) {
      node.y = round(Math.max(node.y, nextY));
      const nodeGap = computeAdaptiveCellGap(node, levelNodes, layoutIntent, gap, fanoutGap, cellSpacing);
      nextY = node.y + node.height + nodeGap;
    }
  }
}

export function resolveOutputOverlaps(nodes, margin, gap = 8) {
  for (const node of nodes.filter(isOutputNode).sort(compareNodes)) {
    node.y = findNearestFreeY(node, node.y, nodes, new Set([node.id]), margin, gap);
  }
}

/**
 * Keep a same-level collapsed group out of the source-adjacent escape rail of
 * a node that drives a different level.  Level placement intentionally shares
 * one x column, but a right-facing hub immediately below a tall group would
 * otherwise be forced to route vertically through that group body.  Only
 * move a group when the concrete source-to-target y span proves that it is a
 * blocker; this keeps ordinary same-level summaries and compact graphs
 * unchanged.
 */
export function resolveGroupEscapeOverlaps(nodes, edges, gap = 8) {
  const nodeById = new Map((nodes || []).map((node) => [node.id, node]));
  const edgesBySource = new Map();
  for (const edge of edges || []) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target || source.level === target.level) continue;
    const list = edgesBySource.get(source.id) || [];
    list.push({ edge, target });
    edgesBySource.set(source.id, list);
  }
  const groupsByLevel = new Map();
  for (const group of nodes || []) {
    if (group.kind !== "group") continue;
    const list = groupsByLevel.get(group.level) || [];
    list.push(group);
    groupsByLevel.set(group.level, list);
  }
  for (const [level, groups] of groupsByLevel) {
    const peers = (nodes || []).filter((node) => node.level === level);
    const orderedGroups = [...groups].sort((left, right) =>
      Number(left.x) - Number(right.x) || String(left.id).localeCompare(String(right.id)));
    for (const group of orderedGroups) {
      const blockers = [];
      for (const source of peers) {
        if (source.id === group.id || source.kind === "group") continue;
        const sourceEdges = edgesBySource.get(source.id) || [];
        for (const { edge, target } of sourceEdges) {
          const sourcePoint = getConnectionPoint(source, edge.sourcePin, "source");
          const side = getPort(source, edge.sourcePin, "source")?.side || "right";
          if (side !== "left" && side !== "right") continue;
          const targetPoint = getConnectionPoint(target, edge.targetPin, "target");
          const sourceRailX = side === "right" ? sourcePoint.x : sourcePoint.x;
          const railInsideGroup = sourceRailX > group.x && sourceRailX < group.x + group.width;
          const yStart = Math.min(sourcePoint.y, targetPoint.y);
          const yEnd = Math.max(sourcePoint.y, targetPoint.y);
          const verticalBlocker = yEnd > group.y && yStart < group.y + group.height;
          if (!railInsideGroup || !verticalBlocker) continue;
          blockers.push({ source, side });
        }
      }
      if (blockers.length === 0) continue;
      const direction = blockers.some(({ side }) => side === "right") ? -1 : 1;
      const shift = Number(group.width) + Math.max(0, Number(gap) || 0);
      for (let attempt = 0; attempt < MAX_GROUP_ESCAPE_SHIFTS; attempt += 1) {
        // The blocker test is deliberately independent of body overlap: a
        // source hub can sit below the group while its vertical escape rail
        // still passes through the group's x-range.  Move once to clear that
        // rail, then continue only when the move created a real node overlap.
        if (attempt === 0) {
          group.x += direction * shift;
          continue;
        }
        const collidesWithPeer = peers.some((peer) =>
          peer.id !== group.id && peer.kind !== "group" &&
          horizontalRangesOverlap(group, peer, 0) &&
          verticalRangesOverlap(group, peer, 0));
        const collidesWithGroup = orderedGroups.some((peer) =>
          peer.id !== group.id && horizontalRangesOverlap(group, peer, 0) &&
          verticalRangesOverlap(group, peer, 0));
        if (!collidesWithPeer && !collidesWithGroup) break;
        group.x += direction * shift;
      }
    }
  }
}

export function computeLevelXs(
  graph,
  levels,
  buckets,
  levelKeys,
  nodeSizes,
  baseSpacing,
  margin,
  localizeSingleFanoutInputs = true,
  layoutIntent = null,
  adaptiveSpacing = null
) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoingCounts = new Map();
  const outgoingNets = new Map();
  for (const edge of graph.edges) {
    outgoingCounts.set(edge.source, (outgoingCounts.get(edge.source) || 0) + 1);
    if (!outgoingNets.has(edge.source)) outgoingNets.set(edge.source, new Set());
    outgoingNets.get(edge.source).add(edge.net);
  }
  const localizedInputWidths = new Map();
  if (localizeSingleFanoutInputs) {
    for (const edge of graph.edges) {
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      const outgoingCount = outgoingCounts.get(edge.source) || 0;
      if (
        (target?.kind === "cell" || target?.kind === "hub") &&
        isExternalSourceNode(source) &&
        outgoingCount > 0 &&
        outgoingCount <= MAX_LOCALIZED_INPUT_LOADS &&
        (outgoingCount === 1 || outgoingNets.get(edge.source)?.size === 1)
      ) {
        const targetLevel = levels.get(edge.target);
        const cellSpacing = Number(adaptiveSpacing?.cellSpacing) || 8;
        const branchLanePitch = Number(adaptiveSpacing?.branchLanePitch) || 16;
        const targetGap = Math.max(4, 24 + cellSpacing - 8) +
          (outgoingCount > 1 ? 4 + branchLanePitch : 0);
        localizedInputWidths.set(
          targetLevel,
          Math.max(
            localizedInputWidths.get(targetLevel) || 0,
            (nodeSizes.get(edge.source)?.width || 0) + targetGap
          )
        );
      }
    }
  }

  const levelXs = new Map();
  let x = margin;
  for (const [index, level] of levelKeys.entries()) {
    levelXs.set(level, x);
    const nextLevel = levelKeys[index + 1];
    if (nextLevel === undefined) continue;
    const levelWidth = Math.max(
      ...(buckets.get(level) || []).map((node) => nodeSizes.get(node.id).width),
      0
    );
    const localizedInputReservation = localizedInputWidths.get(nextLevel) || 0;
    const cellSpacing = Number(adaptiveSpacing?.cellSpacing) || 8;
    const localizedInputSpacing = localizedInputReservation > 0
      ? nextLevel <= 1
        ? Math.max(levelWidth, localizedInputReservation) + cellSpacing
        : levelWidth + localizedInputReservation + cellSpacing
      : 0;
    const pressure = layoutIntent?.getBoundaryPressure(level) || 1;
    const compactX = Number(adaptiveSpacing?.compactX) || baseSpacing;
    const fanoutX = Number(adaptiveSpacing?.fanoutX) || baseSpacing;
    const lanePitch = Number(adaptiveSpacing?.wireLanePitch) || 18;
    const requestedStep = pressure > 1 ? fanoutX + pressure * lanePitch : compactX;
    const congestion = getLevelCongestion(buckets.get(level) || [], buckets.get(nextLevel) || [], pressure);
    const routingClearance = (pressure > 1 ? 72 : 40) + Math.max(0, cellSpacing - 8) + congestion;
    const adaptiveStep = Math.max(requestedStep, levelWidth + routingClearance);
    x += Math.max(adaptiveStep * (nextLevel - level), localizedInputSpacing);
  }
  return levelXs;
}

function getPrimaryCellChainTargets(layoutIntent) {
  const targets = new Set();
  if (!layoutIntent?.netGroups) return targets;
  for (const edges of layoutIntent.netGroups.values()) {
    for (const edge of edges) {
      const intent = layoutIntent.getEdge(edge);
      if (intent?.isPrimary && intent.sourceKind === "cell" && intent.targetKind === "cell") {
        targets.add(edge.target);
      }
    }
  }
  return targets;
}

function resolveLevelAroundPrimaryChain(
  levelNodes,
  anchoredNodes,
  margin,
  gap,
  layoutIntent,
  fanoutGap,
  cellSpacing
) {
  const placed = [];
  let nextAnchorY = margin;
  for (const anchor of anchoredNodes.toSorted((left, right) =>
    left.y - right.y || compareNodes(left, right))) {
    anchor.y = round(Math.max(anchor.y, nextAnchorY));
    placed.push(anchor);
    const anchorGap = computeAdaptiveCellGap(anchor, levelNodes, layoutIntent, gap, fanoutGap, cellSpacing);
    nextAnchorY = anchor.y + anchor.height + anchorGap;
  }

  const anchoredIds = new Set(anchoredNodes.map((node) => node.id));
  for (const node of levelNodes
    .filter((candidate) => !anchoredIds.has(candidate.id))
    .toSorted((left, right) => left.y - right.y || compareNodes(left, right))) {
    const nodeGap = computeAdaptiveCellGap(node, levelNodes, layoutIntent, gap, fanoutGap, cellSpacing);
    node.y = findNearestFreeY(node, node.y, placed, new Set([node.id]), margin, nodeGap);
    placed.push(node);
  }
}

export function computeAdaptiveCellGap(node, levelNodes, layoutIntent, compactGap, fanoutGap, cellSpacing) {
  const base = Math.max(Number(compactGap) || 0, Number(cellSpacing) || 8);
  const fanout = layoutIntent?.getNodeFanout(node) || 0;
  const pressure = layoutIntent?.getBoundaryPressure(node.level) || 1;
  const pinCount = node.ports?.length || node.portDescriptors?.length || 0;
  const density = Math.max(0, (levelNodes?.length || 1) - 4);
  const congestion = Math.min(48,
    Math.max(0, pressure - 1) * 2 + Math.max(0, pinCount - 4) * 2 + Math.min(12, density));
  return Math.max(fanout > 1 ? Number(fanoutGap) || base : base, base + congestion);
}

function getLevelCongestion(leftNodes, rightNodes, pressure) {
  const maxPins = Math.max(0, ...[...leftNodes, ...rightNodes].map((node) => node.portDescriptors?.length || 0));
  const density = Math.max(leftNodes.length, rightNodes.length);
  return Math.min(64, Math.max(0, pressure - 1) * 2 + Math.max(0, maxPins - 4) * 2 + Math.max(0, density - 8));
}

function horizontalRangesOverlap(left, right, gap = 0) {
  return left.x < right.x + right.width + gap && left.x + left.width + gap > right.x;
}

function verticalRangesOverlap(left, right, gap = 0) {
  return left.y < right.y + right.height + gap && left.y + left.height + gap > right.y;
}
