import {
  compareNodes,
  findNearestFreeY,
  isExternalSourceNode,
  round
} from "./nodePlacementShared.js";

export function resolveExternalSourceOverlaps(nodes, margin, gap = 8) {
  const sources = nodes
    .filter(isExternalSourceNode)
    .toSorted((left, right) => left.y - right.y || compareNodes(left, right));
  let nextY = margin;
  for (const source of sources) {
    source.y = round(Math.max(source.y, nextY));
    nextY = source.y + source.height + gap;
  }
}

export function resolveLevelOverlaps(
  nodes,
  levelKeys,
  margin,
  gap = 16,
  layoutIntent = null,
  fanoutGap = gap
) {
  const primaryChainTargets = getPrimaryCellChainTargets(layoutIntent);
  for (const level of levelKeys) {
    const levelNodes = nodes
      .filter((node) => node.level === level)
      .sort((left, right) => left.y - right.y || compareNodes(left, right));
    const anchoredNodes = levelNodes.filter((node) => primaryChainTargets.has(node.id));
    if (anchoredNodes.length > 0) {
      resolveLevelAroundPrimaryChain(levelNodes, anchoredNodes, margin, gap, layoutIntent, fanoutGap);
      continue;
    }

    let nextY = margin;
    for (const node of levelNodes) {
      node.y = round(Math.max(node.y, nextY));
      const nodeGap = layoutIntent?.getNodeFanout(node) > 1 ? fanoutGap : gap;
      nextY = node.y + node.height + nodeGap;
    }
  }
}

export function resolveOutputOverlaps(nodes, margin) {
  for (const node of nodes.filter((item) => item.kind === "output").sort(compareNodes)) {
    node.y = findNearestFreeY(node, node.y, nodes, new Set([node.id]), margin);
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
    const routingClearance = pressure > 1 ? 72 : 40;
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
  fanoutGap
) {
  const placed = [];
  let nextAnchorY = margin;
  for (const anchor of anchoredNodes.toSorted((left, right) =>
    left.y - right.y || compareNodes(left, right))) {
    anchor.y = round(Math.max(anchor.y, nextAnchorY));
    placed.push(anchor);
    const anchorGap = layoutIntent?.getNodeFanout(anchor) > 1 ? fanoutGap : gap;
    nextAnchorY = anchor.y + anchor.height + anchorGap;
  }

  const anchoredIds = new Set(anchoredNodes.map((node) => node.id));
  for (const node of levelNodes
    .filter((candidate) => !anchoredIds.has(candidate.id))
    .toSorted((left, right) => left.y - right.y || compareNodes(left, right))) {
    const nodeGap = layoutIntent?.getNodeFanout(node) > 1 ? fanoutGap : gap;
    node.y = findNearestFreeY(node, node.y, placed, new Set([node.id]), margin, nodeGap);
    placed.push(node);
  }
}
