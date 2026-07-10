import { getPort } from "./nodeGeometry.js";

export function applyNodePositionOverrides(nodes, nodePositions) {
  if (!nodePositions) {
    return;
  }

  for (const node of nodes) {
    const override = getNodePositionOverride(nodePositions, node.id);
    if (!override) {
      continue;
    }
    const x = Number(override.x);
    const y = Number(override.y);
    if (Number.isFinite(x)) {
      node.x = x;
    }
    if (Number.isFinite(y)) {
      node.y = y;
    }
  }
}

export function applyNodeSizeOverride(size, nodeSizes, nodeId) {
  const override = getNodeSizeOverride(nodeSizes, nodeId);
  if (!override) {
    return size;
  }

  const width = Number(override.width);
  const height = Number(override.height);
  return {
    width: Number.isFinite(width) ? clamp(width, 24, 420) : size.width,
    height: Number.isFinite(height) ? clamp(height, 12, 260) : size.height
  };
}

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

export function alignDrivenTargetsToDriverPins(nodes, edges, levelKeys) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incomingByTarget = new Map();
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
      const edge = chooseAlignmentEdge(incomingByTarget.get(target.id), nodeById);
      if (!edge) {
        continue;
      }
      const source = nodeById.get(edge.source);
      const sourcePort = getPort(source, edge.sourcePin, "source");
      const targetPort = getPort(target, edge.targetPin, "target");
      const sourceY = source.y + (sourcePort?.y ?? source.height / 2);
      const targetPinOffsetY = targetPort?.y ?? target.height / 2;
      target.y = round(sourceY - targetPinOffsetY);
    }
  }
}

export function applySingleFanoutInputLocality(nodes, edges, margin) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const outgoingBySource = new Map();
  for (const edge of edges) {
    if (!outgoingBySource.has(edge.source)) {
      outgoingBySource.set(edge.source, []);
    }
    outgoingBySource.get(edge.source).push(edge);
  }

  for (const node of nodes) {
    if (!isExternalSourceNode(node)) {
      continue;
    }
    const outgoing = outgoingBySource.get(node.id) || [];
    if (outgoing.length !== 1) {
      continue;
    }

    const edge = outgoing[0];
    const target = nodeById.get(edge.target);
    if (!target || target.kind !== "cell") {
      continue;
    }

    const sourcePort = getPort(node, edge.sourcePin, "source");
    const targetPort = getPort(target, edge.targetPin, "target");
    const targetInputIndex = target.ports
      .filter((port) => port.direction === "input")
      .findIndex((port) => port.pin === targetPort?.pin);
    const gap = 24;
    node.x = Math.max(margin, target.x - node.width - gap);
    node.y = round(target.y + (targetPort?.y ?? target.height / 2) - (sourcePort?.y ?? node.height / 2));
    node.order = targetInputIndex >= 0 ? targetInputIndex : node.order;
  }
}

export function resolveOutputOverlaps(nodes, margin) {
  for (const node of nodes.filter((item) => item.kind === "output").sort(compareNodes)) {
    node.y = findNearestFreeY(node, node.y, nodes, new Set([node.id]), margin);
  }
}

export function computeLevelXs(graph, levels, buckets, levelKeys, nodeSizes, baseSpacing, margin) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoingCounts = new Map();
  for (const edge of graph.edges) {
    outgoingCounts.set(edge.source, (outgoingCounts.get(edge.source) || 0) + 1);
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
    const localizedInputWidth = nextLevel <= 1
      ? 0
      : Math.max(
          ...graph.edges
            .filter((edge) => {
              const source = nodeById.get(edge.source);
              const target = nodeById.get(edge.target);
              return (
                levels.get(edge.target) === nextLevel &&
                target?.kind === "cell" &&
                isExternalSourceNode(source) &&
                outgoingCounts.get(edge.source) === 1
              );
            })
            .map((edge) => nodeSizes.get(edge.source)?.width || 0),
          0
        );
    const localizedInputSpacing = localizedInputWidth > 0
      ? levelWidth + localizedInputWidth + 48
      : 0;
    x += Math.max(baseSpacing * (nextLevel - level), localizedInputSpacing);
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

function getNodeSizeOverride(nodeSizes, nodeId) {
  if (!nodeSizes) {
    return null;
  }
  if (nodeSizes instanceof Map) {
    return nodeSizes.get(nodeId);
  }
  if (Array.isArray(nodeSizes)) {
    return nodeSizes.find((item) => item?.id === nodeId);
  }
  if (typeof nodeSizes === "object") {
    return Object.hasOwn(nodeSizes, nodeId) ? nodeSizes[nodeId] : null;
  }
  return null;
}

function getNodePositionOverride(nodePositions, nodeId) {
  if (nodePositions instanceof Map) {
    return nodePositions.get(nodeId);
  }
  if (Array.isArray(nodePositions)) {
    return nodePositions.find((item) => item?.id === nodeId);
  }
  if (typeof nodePositions === "object") {
    return Object.hasOwn(nodePositions, nodeId) ? nodePositions[nodeId] : null;
  }
  return null;
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

function chooseAlignmentEdge(edges, nodeById) {
  if (!edges || edges.length === 0) {
    return null;
  }
  if (edges.length > 1) {
    return edges.toSorted((left, right) => {
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
  return edges
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
