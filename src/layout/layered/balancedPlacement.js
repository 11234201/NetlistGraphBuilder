import { compareNodes, groupNodesByLevel, round } from "../nodePlacementShared.js";

const DEFAULT_SWEEPS = 4;

/**
 * Place ordered layers around a shared vertical centre, then pull nodes toward
 * the median port position of their neighbours. Layer order is immutable and
 * every compaction pass enforces the requested separation.
 */
export function applyBalancedLayerPlacement(
  nodes,
  edges,
  levelKeys,
  { minimumY = 0, gap = 8, sweeps = DEFAULT_SWEEPS } = {}
) {
  if (!Array.isArray(nodes) || nodes.length === 0) return nodes;
  const nodesByLevel = groupNodesByLevel(nodes);
  const orderedByLevel = new Map();
  for (const level of levelKeys || []) {
    orderedByLevel.set(level, (nodesByLevel.get(level) || []).toSorted(compareNodes));
  }
  const maximumHeight = Math.max(0, ...[...orderedByLevel.values()].map((layer) =>
    packedHeight(layer, gap)));
  for (const layer of orderedByLevel.values()) {
    let nextY = minimumY + (maximumHeight - packedHeight(layer, gap)) / 2;
    for (const node of layer) {
      node.y = round(nextY);
      nextY += node.height + gap;
    }
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incident = buildIncidentEdges(edges, nodeById);
  const passes = Math.max(0, Math.min(16, Math.floor(Number(sweeps) || 0)));
  for (let pass = 0; pass < passes; pass += 1) {
    const levels = pass % 2 === 0 ? [...(levelKeys || [])] : [...(levelKeys || [])].reverse();
    for (const level of levels) {
      const layer = orderedByLevel.get(level) || [];
      if (layer.length === 0) continue;
      const preferred = layer.map((node) => preferredNodeY(node, incident.get(node.id), nodeById));
      const compacted = compactOrderedLayer(layer, preferred, minimumY, gap);
      for (let index = 0; index < layer.length; index += 1) layer[index].y = compacted[index];
    }
  }
  return nodes;
}

export function compactOrderedLayer(nodes, preferredYs, minimumY = 0, gap = 8) {
  if (!nodes.length) return [];
  const forward = [];
  let nextY = minimumY;
  for (let index = 0; index < nodes.length; index += 1) {
    const y = Math.max(nextY, finiteOr(preferredYs[index], nodes[index].y));
    forward.push(round(y));
    nextY = y + nodes[index].height + gap;
  }

  const reverse = new Array(nodes.length);
  let previousY = Infinity;
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const maximum = Number.isFinite(previousY)
      ? previousY - nodes[index].height - gap
      : finiteOr(preferredYs[index], nodes[index].y);
    reverse[index] = round(Math.min(finiteOr(preferredYs[index], nodes[index].y), maximum));
    previousY = reverse[index];
  }
  const shift = Math.max(0, minimumY - reverse[0]);
  for (let index = 0; index < reverse.length; index += 1) reverse[index] = round(reverse[index] + shift);

  return placementScore(reverse, preferredYs) < placementScore(forward, preferredYs)
    ? reverse
    : forward;
}

function buildIncidentEdges(edges, nodeById) {
  const incident = new Map();
  for (const edge of [...(edges || [])].toSorted(compareEdges)) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    addIncident(incident, edge.source, { edge, neighborId: edge.target, role: "source" });
    addIncident(incident, edge.target, { edge, neighborId: edge.source, role: "target" });
  }
  return incident;
}

function preferredNodeY(node, links = [], nodeById) {
  const candidates = [];
  for (const link of links) {
    const neighbor = nodeById.get(link.neighborId);
    if (!neighbor || neighbor.level === node.level) continue;
    const ownPin = link.role === "source" ? link.edge.sourcePin : link.edge.targetPin;
    const neighborPin = link.role === "source" ? link.edge.targetPin : link.edge.sourcePin;
    const ownOffset = portOffset(node, ownPin, link.role);
    const neighborOffset = portOffset(neighbor, neighborPin, link.role === "source" ? "target" : "source");
    candidates.push(neighbor.y + neighborOffset - ownOffset);
  }
  if (candidates.length === 0) return node.y;
  candidates.sort((left, right) => left - right);
  const middle = Math.floor(candidates.length / 2);
  return candidates.length % 2 === 1
    ? candidates[middle]
    : (candidates[middle - 1] + candidates[middle]) / 2;
}

function portOffset(node, pin, role) {
  const direction = role === "source" ? "output" : "input";
  const port = node.ports?.find((candidate) =>
    (candidate.pin === pin || candidate.rawPin === pin) && candidate.direction === direction) ||
    node.ports?.find((candidate) => candidate.direction === direction);
  return Number.isFinite(Number(port?.y)) ? Number(port.y) : Number(node.height) / 2;
}

function packedHeight(nodes, gap) {
  return nodes.reduce((total, node) => total + Number(node.height || 0), 0) +
    Math.max(0, nodes.length - 1) * gap;
}

function placementScore(positions, preferred) {
  return positions.reduce((score, y, index) => score + Math.abs(y - finiteOr(preferred[index], y)), 0);
}

function addIncident(incident, id, link) {
  if (!incident.has(id)) incident.set(id, []);
  incident.get(id).push(link);
}

function compareEdges(left, right) {
  return String(left.source).localeCompare(String(right.source)) ||
    String(left.target).localeCompare(String(right.target)) ||
    String(left.sourcePin || "").localeCompare(String(right.sourcePin || "")) ||
    String(left.targetPin || "").localeCompare(String(right.targetPin || "")) ||
    String(left.id || "").localeCompare(String(right.id || ""));
}

function finiteOr(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : Number(fallback) || 0;
}
