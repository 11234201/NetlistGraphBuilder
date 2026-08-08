import {
  compareNodes,
  findNearestFreeY,
  groupNodesByLevel,
  isExternalSourceNode,
  round,
  stackNodesVertically
} from "./nodePlacementShared.js";

export function resolveExternalSourceOverlaps(nodes, margin, gap = 8) {
  const sources = nodes
    .filter(isExternalSourceNode)
    .toSorted((left, right) => left.y - right.y || compareNodes(left, right));
  stackNodesVertically(sources, margin, gap);
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
  for (const node of nodes.filter((item) => item.kind === "output").sort(compareNodes)) {
    node.y = findNearestFreeY(node, node.y, nodes, new Set([node.id]), margin, gap);
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
  for (const edge of graph.edges) {
    outgoingCounts.set(edge.source, (outgoingCounts.get(edge.source) || 0) + 1);
  }
  const localizedInputWidths = new Map();
  if (localizeSingleFanoutInputs) {
    for (const edge of graph.edges) {
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (
        (target?.kind === "cell" || target?.kind === "hub") &&
        isExternalSourceNode(source) &&
        outgoingCounts.get(edge.source) === 1
      ) {
        const targetLevel = levels.get(edge.target);
        localizedInputWidths.set(
          targetLevel,
          Math.max(localizedInputWidths.get(targetLevel) || 0, nodeSizes.get(edge.source)?.width || 0)
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
    const localizedInputWidth = localizedInputWidths.get(nextLevel) || 0;
    const localizedInputSpacing = localizedInputWidth > 0
      ? nextLevel <= 1
        ? Math.max(levelWidth, localizedInputWidth) + 32
        : levelWidth + localizedInputWidth + 32
      : 0;
    const pressure = layoutIntent?.getBoundaryPressure(level) || 1;
    const compactX = Number(adaptiveSpacing?.compactX) || baseSpacing;
    const fanoutX = Number(adaptiveSpacing?.fanoutX) || baseSpacing;
    const lanePitch = Number(adaptiveSpacing?.wireLanePitch) || 18;
    const requestedStep = pressure > 1 ? fanoutX + pressure * lanePitch : compactX;
    const cellSpacing = Number(adaptiveSpacing?.cellSpacing) || 8;
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
  const pinCount = node.ports?.length || node.ref?.pins?.length || 0;
  const density = Math.max(0, (levelNodes?.length || 1) - 4);
  const congestion = Math.min(48,
    Math.max(0, pressure - 1) * 2 + Math.max(0, pinCount - 4) * 2 + Math.min(12, density));
  return Math.max(fanout > 1 ? Number(fanoutGap) || base : base, base + congestion);
}

function getLevelCongestion(leftNodes, rightNodes, pressure) {
  const maxPins = Math.max(0, ...[...leftNodes, ...rightNodes].map((node) => node.ref?.pins?.length || 0));
  const density = Math.max(leftNodes.length, rightNodes.length);
  return Math.min(64, Math.max(0, pressure - 1) * 2 + Math.max(0, maxPins - 4) * 2 + Math.max(0, density - 8));
}
