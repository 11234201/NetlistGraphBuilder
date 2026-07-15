import { getPort } from "./nodeGeometry.js";
import {
  compareNodes,
  getInputPortIndex,
  getInputPorts,
  groupEdges,
  isExternalSourceNode,
  round
} from "./nodePlacementShared.js";

export function applyBranchAwareLanes(nodes, edges, levelKeys, topY, lanePitch) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incomingByTarget = groupEdges(edges, "target");
  const laneById = new Map();
  const upperLane = 0;
  const lowerLane = 1;

  for (const target of nodes) {
    if (target.kind !== "cell") continue;
    const incomingCellEdges = (incomingByTarget.get(target.id) || []).filter(
      (edge) => nodeById.get(edge.source)?.kind === "cell"
    );
    const inputPorts = getInputPorts(target);
    if (incomingCellEdges.length < 2 || inputPorts.length < 3) continue;

    let targetLane = upperLane;
    for (const edge of incomingCellEdges) {
      const pinIndex = getInputPortIndex(target, edge.targetPin);
      const lane = pinIndex >= Math.floor(inputPorts.length / 2) ? lowerLane : upperLane;
      targetLane = Math.max(targetLane, lane);
      markUpstreamLane(edge.source, lane, laneById, incomingByTarget);
    }
    laneById.set(target.id, targetLane);
  }

  if (laneById.size === 0) return;
  const laneY = new Map([[upperLane, topY], [lowerLane, topY + lanePitch]]);
  for (const level of levelKeys) {
    for (const node of nodes.filter((item) => item.level === level).sort(compareNodes)) {
      const lane = laneById.get(node.id);
      if (lane === undefined || !isLanePositionedNode(node)) continue;
      const incomingSameLane = (incomingByTarget.get(node.id) || []).some(
        (edge) => laneById.get(edge.source) === lane && isLanePositionedNode(nodeById.get(edge.source))
      );
      if (!incomingSameLane) node.y = laneY.get(lane) ?? node.y;
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
    if (!isAlignableDriver(source) || !isAlignableDrivenTarget(target)) continue;
    if (!incomingByTarget.has(target.id)) incomingByTarget.set(target.id, []);
    incomingByTarget.get(target.id).push(edge);
  }

  for (const level of levelKeys) {
    const levelNodes = nodes
      .filter((node) => node.level === level && isAlignableDrivenTarget(node))
      .sort(compareNodes);
    for (const target of levelNodes) {
      const edge = chooseAlignmentEdge(incomingByTarget.get(target.id), nodeById, layoutIntent);
      if (!edge) continue;
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
    for (const node of component) node.y = round(node.y + shift);
  }
}

function addNeighbor(neighbors, nodeId, neighborId) {
  if (!neighbors.has(nodeId)) neighbors.set(nodeId, []);
  neighbors.get(nodeId).push(neighborId);
}

function markUpstreamLane(nodeId, lane, laneById, incomingByTarget) {
  const previousLane = laneById.get(nodeId);
  if (previousLane !== undefined && previousLane <= lane) return;
  laneById.set(nodeId, lane);
  for (const edge of incomingByTarget.get(nodeId) || []) {
    markUpstreamLane(edge.source, lane, laneById, incomingByTarget);
  }
}

function isLanePositionedNode(node) {
  return node?.kind === "cell" || node?.kind === "assign" || node?.kind === "output";
}

function isAlignableDrivenTarget(node) {
  return node?.kind === "cell" || node?.kind === "assign" || node?.kind === "output";
}

function isAlignableDriver(node) {
  return node?.kind === "cell" || node?.kind === "assign";
}

function chooseAlignmentEdge(edges, nodeById, layoutIntent) {
  if (!edges || edges.length === 0) return null;
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
      const leftIndex = getInputPortIndex(nodeById.get(left.target), left.targetPin);
      const rightIndex = getInputPortIndex(nodeById.get(right.target), right.targetPin);
      if (leftIndex !== rightIndex) return rightIndex - leftIndex;
      return String(left.targetPin || "").localeCompare(String(right.targetPin || ""));
    })[0];
  }
  return preferredEdges.toSorted((left, right) => {
    const leftSource = nodeById.get(left.source);
    const rightSource = nodeById.get(right.source);
    if ((leftSource?.level ?? 0) !== (rightSource?.level ?? 0)) {
      return (rightSource?.level ?? 0) - (leftSource?.level ?? 0);
    }
    return String(left.targetPin || "").localeCompare(String(right.targetPin || ""));
  })[0];
}
