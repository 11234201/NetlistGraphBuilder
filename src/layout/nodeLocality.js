import { getPort } from "./nodeGeometry.js";
import {
  compareNodes,
  findNearestFreeY,
  getInputPortIndex,
  groupEdges,
  isExternalSourceNode,
  round
} from "./nodePlacementShared.js";

export function applySingleFanoutInputLocality(
  nodes,
  edges,
  margin,
  layoutIntent = null,
  branchLanePitch = 16
) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const outgoingBySource = groupEdges(edges, "source");
  const primaryEdgeBySource = new Map();
  for (const [sourceId, outgoing] of outgoingBySource) {
    if (outgoing.length > 1 && new Set(outgoing.map((edge) => edge.net)).size > 1) continue;
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
    if (!isExternalSourceNode(node)) continue;
    const outgoing = outgoingBySource.get(node.id) || [];
    if (outgoing.length === 0) continue;
    const edge = primaryEdgeBySource.get(node.id);
    if (!edge) continue;
    const target = nodeById.get(edge.target);
    if (!target || (target.kind !== "cell" && target.kind !== "hub")) continue;

    const sourcePort = getPort(node, edge.sourcePin, "source");
    const targetPort = getPort(target, edge.targetPin, "target");
    const targetInputIndex = target.ports
      .filter((port) => port.direction === "input")
      .findIndex((port) => port.pin === targetPort?.pin);
    const laneRank = multiInputLaneRanks.get(node.id) || 0;
    const gap = outgoing.length === 1 ? 24 : 28 + laneRank * branchLanePitch;
    if (targetPort?.side === "top" || targetPort?.side === "bottom") {
      node.x = round(Math.max(margin, target.x + targetPort.x - (sourcePort?.x ?? node.width)));
      node.y = targetPort.side === "top"
        ? round(Math.max(margin, target.y - node.height - 12))
        : round(target.y + target.height + 12);
    } else {
      node.x = Math.max(margin, target.x - node.width - gap);
      node.y = round(
        target.y + (targetPort?.y ?? target.height / 2) - (sourcePort?.y ?? node.height / 2)
      );
    }
    node.order = targetInputIndex >= 0 ? targetInputIndex : node.order;
  }
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
