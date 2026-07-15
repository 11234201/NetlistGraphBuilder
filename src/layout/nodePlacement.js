import { getPort } from "./nodeGeometry.js";

export function applyBranchAwareLanes(nodes, edges, levelKeys, topY, lanePitch) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incomingByTarget = groupEdges(edges, "target");
  const laneById = new Map();
  const upperLane = 0;
  const lowerLane = 1;

  for (const target of nodes) {
    if (target.kind !== "cell") {
      continue;
    }
    const incomingCellEdges = (incomingByTarget.get(target.id) || []).filter(
      (edge) => nodeById.get(edge.source)?.kind === "cell"
    );
    const inputPorts = getInputPorts(target);
    if (incomingCellEdges.length < 2 || inputPorts.length < 3) {
      continue;
    }

    let targetLane = upperLane;
    for (const edge of incomingCellEdges) {
      const pinIndex = getInputPortIndex(target, edge.targetPin);
      const lane = pinIndex >= Math.floor(inputPorts.length / 2) ? lowerLane : upperLane;
      targetLane = Math.max(targetLane, lane);
      markUpstreamLane(edge.source, lane, laneById, incomingByTarget);
    }
    laneById.set(target.id, targetLane);
  }

  if (laneById.size === 0) {
    return;
  }

  const laneY = new Map([
    [upperLane, topY],
    [lowerLane, topY + lanePitch]
  ]);
  for (const level of levelKeys) {
    for (const node of nodes.filter((item) => item.level === level).sort(compareNodes)) {
      const lane = laneById.get(node.id);
      if (lane === undefined || !isLanePositionedNode(node)) {
        continue;
      }
      const incomingSameLane = (incomingByTarget.get(node.id) || []).some(
        (edge) => laneById.get(edge.source) === lane && isLanePositionedNode(nodeById.get(edge.source))
      );
      if (!incomingSameLane) {
        node.y = laneY.get(lane) ?? node.y;
      }
    }
  }
}

export function alignDrivenTargetsToDriverPins(nodes, edges, levelKeys, layoutIntent, margin = 0) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incomingByTarget = new Map();
  const alignedEdges = [];
  for (const edge of edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!isAlignableDriver(source) || !isAlignableDrivenTarget(target)) {
      continue;
    }
    if (!incomingByTarget.has(target.id)) {
      incomingByTarget.set(target.id, []);
    }
    incomingByTarget.get(target.id).push(edge);
  }

  for (const level of levelKeys) {
    const levelNodes = nodes
      .filter((node) => node.level === level && isAlignableDrivenTarget(node))
      .sort(compareNodes);
    for (const target of levelNodes) {
      const edge = chooseAlignmentEdge(incomingByTarget.get(target.id), nodeById, layoutIntent);
      if (!edge) {
        continue;
      }
      const source = nodeById.get(edge.source);
      const sourcePort = getPort(source, edge.sourcePin, "source");
      const targetPort = getPort(target, edge.targetPin, "target");
      const sourceY = source.y + (sourcePort?.y ?? source.height / 2);
      const targetPinOffsetY = targetPort?.y ?? target.height / 2;
      target.y = round(sourceY - targetPinOffsetY);
      alignedEdges.push(edge);
    }
  }

  shiftAlignedComponentsInsideMargin(nodeById, alignedEdges, margin);
}

function shiftAlignedComponentsInsideMargin(nodeById, alignedEdges, margin) {
  if (alignedEdges.length === 0) return;
  const neighbors = new Map();
  for (const edge of alignedEdges) {
    addNeighbor(neighbors, edge.source, edge.target);
    addNeighbor(neighbors, edge.target, edge.source);
  }

  const visited = new Set();
  for (const nodeId of neighbors.keys()) {
    if (visited.has(nodeId)) continue;
    const component = [];
    const pending = [nodeId];
    visited.add(nodeId);
    while (pending.length > 0) {
      const currentId = pending.pop();
      const node = nodeById.get(currentId);
      if (node) component.push(node);
      for (const neighborId of neighbors.get(currentId) || []) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);
        pending.push(neighborId);
      }
    }

    const minY = Math.min(...component.map((node) => node.y));
    const shift = Math.max(0, margin - minY);
    if (shift <= 0) continue;
    for (const node of component) {
      node.y = round(node.y + shift);
    }
  }
}

function addNeighbor(neighbors, nodeId, neighborId) {
  if (!neighbors.has(nodeId)) neighbors.set(nodeId, []);
  neighbors.get(nodeId).push(neighborId);
}

export function alignSingleConnectionEndpoints(nodes, edges, layoutIntent) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const edge of edges) {
    const intent = layoutIntent?.getEdge(edge);
    if (intent?.fanout !== 1) continue;
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!isExternalSourceNode(source) || !target) continue;
    const sourcePort = getPort(source, edge.sourcePin, "source");
    const targetPort = getPort(target, edge.targetPin, "target");
    source.y = round(
      target.y + (targetPort?.y ?? target.height / 2) - (sourcePort?.y ?? source.height / 2)
    );
  }
}

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

export function resolveLevelOverlaps(nodes, levelKeys, margin, gap = 16, layoutIntent = null, fanoutGap = gap) {
  const primaryChainTargets = getPrimaryCellChainTargets(layoutIntent);
  for (const level of levelKeys) {
    const levelNodes = nodes
      .filter((node) => node.level === level)
      .sort((left, right) => left.y - right.y || compareNodes(left, right));

    const anchoredNodes = levelNodes.filter((node) => primaryChainTargets.has(node.id));
    if (anchoredNodes.length > 0) {
      resolveLevelAroundPrimaryChain(
        levelNodes,
        anchoredNodes,
        margin,
        gap,
        layoutIntent,
        fanoutGap
      );
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

function getPrimaryCellChainTargets(layoutIntent) {
  const targets = new Set();
  if (!layoutIntent?.netGroups) return targets;

  for (const edges of layoutIntent.netGroups.values()) {
    for (const edge of edges) {
      const intent = layoutIntent.getEdge(edge);
      if (
        intent?.isPrimary &&
        intent.sourceKind === "cell" &&
        intent.targetKind === "cell"
      ) {
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

export function applySingleFanoutInputLocality(
  nodes,
  edges,
  margin,
  layoutIntent = null,
  branchLanePitch = 16
) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const outgoingBySource = new Map();
  for (const edge of edges) {
    if (!outgoingBySource.has(edge.source)) {
      outgoingBySource.set(edge.source, []);
    }
    outgoingBySource.get(edge.source).push(edge);
  }

  const primaryEdgeBySource = new Map();
  for (const [sourceId, outgoing] of outgoingBySource) {
    if (outgoing.length > 1 && new Set(outgoing.map((edge) => edge.net)).size > 1) {
      continue;
    }
    const primary = outgoing.length === 1
      ? outgoing[0]
      : outgoing.find((edge) => layoutIntent?.getEdge(edge)?.isPrimary);
    if (primary) primaryEdgeBySource.set(sourceId, primary);
  }
  const multiInputLaneRanks = getMultiInputLaneRanks(
    nodes,
    outgoingBySource,
    primaryEdgeBySource,
    nodeById
  );

  for (const node of nodes) {
    if (!isExternalSourceNode(node)) {
      continue;
    }
    const outgoing = outgoingBySource.get(node.id) || [];
    if (outgoing.length === 0) {
      continue;
    }

    const edge = primaryEdgeBySource.get(node.id);
    if (!edge) continue;
    const target = nodeById.get(edge.target);
    if (!target || (target.kind !== "cell" && target.kind !== "hub")) {
      continue;
    }

    const sourcePort = getPort(node, edge.sourcePin, "source");
    const targetPort = getPort(target, edge.targetPin, "target");
    const targetInputIndex = target.ports
      .filter((port) => port.direction === "input")
      .findIndex((port) => port.pin === targetPort?.pin);
    const laneRank = multiInputLaneRanks.get(node.id) || 0;
    const gap = outgoing.length === 1
      ? 24
      : 28 + laneRank * branchLanePitch;
    if (targetPort?.side === "top" || targetPort?.side === "bottom") {
      node.x = round(Math.max(
        margin,
        target.x + targetPort.x - (sourcePort?.x ?? node.width)
      ));
      node.y = targetPort.side === "top"
        ? round(Math.max(margin, target.y - node.height - 12))
        : round(target.y + target.height + 12);
    } else {
      node.x = Math.max(margin, target.x - node.width - gap);
      node.y = round(
        target.y + (targetPort?.y ?? target.height / 2) -
        (sourcePort?.y ?? node.height / 2)
      );
    }
    node.order = targetInputIndex >= 0 ? targetInputIndex : node.order;
  }
}

function getMultiInputLaneRanks(nodes, outgoingBySource, primaryEdgeBySource, nodeById) {
  const sourcesByTarget = new Map();
  for (const node of nodes) {
    if (!isExternalSourceNode(node) || (outgoingBySource.get(node.id)?.length || 0) <= 1) continue;
    const primary = primaryEdgeBySource.get(node.id);
    const target = nodeById.get(primary?.target);
    if (!primary || target?.kind !== "cell") continue;
    if (!sourcesByTarget.has(target.id)) sourcesByTarget.set(target.id, []);
    sourcesByTarget.get(target.id).push({ node, edge: primary, target });
  }

  const ranks = new Map();
  for (const sources of sourcesByTarget.values()) {
    const ordered = sources.toSorted((left, right) =>
      getInputPortIndex(left.target, left.edge.targetPin) -
      getInputPortIndex(right.target, right.edge.targetPin) ||
      compareNodes(left.node, right.node));
    for (const [index, source] of ordered.entries()) {
      ranks.set(source.node.id, ordered.length - index);
    }
  }
  return ranks;
}

export function applyFanoutHubLocality(nodes, edges, margin) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const outgoingBySource = groupEdges(edges, "source");
  const hubs = nodes.filter((node) => node.kind === "hub");
  const hubIds = new Set(hubs.map((node) => node.id));

  for (const hub of hubs) {
    const targetYs = (outgoingBySource.get(hub.id) || [])
      .map((edge) => {
        const target = nodeById.get(edge.target);
        if (!target) return null;
        const port = getPort(target, edge.targetPin, "target");
        return target.y + (port?.y ?? target.height / 2);
      })
      .filter(Number.isFinite)
      .toSorted((left, right) => left - right);
    if (targetYs.length > 0) {
      const middle = Math.floor(targetYs.length / 2);
      const median = targetYs.length % 2 === 0
        ? (targetYs[middle - 1] + targetYs[middle]) / 2
        : targetYs[middle];
      hub.y = round(median - hub.height / 2);
    }
  }

  const blockers = nodes.filter((node) => !hubIds.has(node.id));
  for (const hub of hubs.toSorted((left, right) => left.y - right.y || compareNodes(left, right))) {
    hub.y = findNearestFreeY(hub, hub.y, blockers, new Set([hub.id]), margin);
    blockers.push(hub);
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
    if (nextLevel === undefined) {
      continue;
    }

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
    const requestedStep = pressure > 1
      ? fanoutX + pressure * lanePitch
      : compactX;
    const routingClearance = pressure > 1 ? 72 : 40;
    const adaptiveStep = Math.max(requestedStep, levelWidth + routingClearance);
    x += Math.max(adaptiveStep * (nextLevel - level), localizedInputSpacing);
  }
  return levelXs;
}

export function compareNodes(left, right) {
  const leftOrder = left.order ?? 1000;
  const rightOrder = right.order ?? 1000;
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  return `${left.kind}:${left.label}`.localeCompare(`${right.kind}:${right.label}`);
}

function markUpstreamLane(nodeId, lane, laneById, incomingByTarget) {
  const previousLane = laneById.get(nodeId);
  if (previousLane !== undefined && previousLane <= lane) {
    return;
  }
  laneById.set(nodeId, lane);
  for (const edge of incomingByTarget.get(nodeId) || []) {
    markUpstreamLane(edge.source, lane, laneById, incomingByTarget);
  }
}

function groupEdges(edges, key) {
  const groups = new Map();
  for (const edge of edges) {
    const id = edge[key];
    if (!groups.has(id)) {
      groups.set(id, []);
    }
    groups.get(id).push(edge);
  }
  return groups;
}

function isLanePositionedNode(node) {
  return node.kind === "cell" || node.kind === "assign" || node.kind === "output";
}

function isAlignableDrivenTarget(node) {
  return node?.kind === "cell" || node?.kind === "assign" || node?.kind === "output";
}

function isAlignableDriver(node) {
  return node?.kind === "cell" || node?.kind === "assign";
}

function chooseAlignmentEdge(edges, nodeById, layoutIntent) {
  if (!edges || edges.length === 0) {
    return null;
  }
  const preferredEdges = layoutIntent
    ? edges.filter((edge) => {
      const intent = layoutIntent.getEdge(edge);
      return intent?.fanout === 1 || intent?.isPrimary;
    })
    : edges;
  if (preferredEdges.length === 0) return null;
  if (preferredEdges.length > 1) {
    return preferredEdges.toSorted((left, right) => {
      const leftIntent = layoutIntent?.getEdge(left);
      const rightIntent = layoutIntent?.getEdge(right);
      if (Boolean(leftIntent?.isPrimary) !== Boolean(rightIntent?.isPrimary)) {
        return leftIntent?.isPrimary ? -1 : 1;
      }
      const leftTarget = nodeById.get(left.target);
      const rightTarget = nodeById.get(right.target);
      const leftIndex = getInputPortIndex(leftTarget, left.targetPin);
      const rightIndex = getInputPortIndex(rightTarget, right.targetPin);
      if (leftIndex !== rightIndex) {
        return rightIndex - leftIndex;
      }
      return String(left.targetPin || "").localeCompare(String(right.targetPin || ""));
    })[0];
  }
  return preferredEdges
    .toSorted((left, right) => {
      const leftSource = nodeById.get(left.source);
      const rightSource = nodeById.get(right.source);
      if ((leftSource?.level ?? 0) !== (rightSource?.level ?? 0)) {
        return (rightSource?.level ?? 0) - (leftSource?.level ?? 0);
      }
      return String(left.targetPin || "").localeCompare(String(right.targetPin || ""));
    })[0];
}

function getInputPorts(node) {
  return (node?.ports || []).filter((port) => port.direction === "input");
}

function getInputPortIndex(node, pin) {
  const ports = getInputPorts(node);
  const index = ports.findIndex((port) => port.pin === pin);
  return index >= 0 ? index : 0;
}

function findNearestFreeY(node, preferredY, nodes, ignoredIds, margin, gap = 12) {
  const blockers = nodes.filter((candidate) =>
    !ignoredIds.has(candidate.id) && horizontalRangesOverlap(node, candidate, gap)
  );
  const candidates = [preferredY];
  for (const blocker of blockers) {
    candidates.push(blocker.y - node.height - gap, blocker.y + blocker.height + gap);
  }

  for (const y of candidates
    .map((candidate) => Math.max(margin, round(candidate)))
    .toSorted((left, right) => Math.abs(left - preferredY) - Math.abs(right - preferredY))) {
    const overlaps = blockers.some((blocker) =>
      y < blocker.y + blocker.height + gap && y + node.height + gap > blocker.y
    );
    if (!overlaps) {
      return y;
    }
  }
  return Math.max(margin, preferredY);
}

function horizontalRangesOverlap(left, right, gap = 0) {
  return left.x < right.x + right.width + gap && left.x + left.width + gap > right.x;
}

function isExternalSourceNode(node) {
  return node.kind === "input" || node.kind === "implicit" || node.kind === "constant";
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
