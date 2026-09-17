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
  {
    minimumY = 0,
    gap = 8,
    sweeps = DEFAULT_SWEEPS,
    alignmentBlocks = true,
    alignmentVariant = {}
  } = {}
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
  const alignment = alignmentBlocks
    ? buildAlignmentBlocks(nodes, edges, levelKeys, alignmentVariant)
    : { blocks: [] };
  const passes = Math.max(0, Math.min(16, Math.floor(Number(sweeps) || 0)));
  for (let pass = 0; pass < passes; pass += 1) {
    const blockPreferred = preferredYsByBlock(alignment.blocks, nodeById);
    const levels = pass % 2 === 0 ? [...(levelKeys || [])] : [...(levelKeys || [])].reverse();
    for (const level of levels) {
      const layer = orderedByLevel.get(level) || [];
      if (layer.length === 0) continue;
      const preferred = layer.map((node) => blockPreferred.get(node.id) ??
        preferredNodeY(node, incident.get(node.id), nodeById));
      const compacted = compactOrderedLayer(layer, preferred, minimumY, gap);
      for (let index = 0; index < layer.length; index += 1) layer[index].y = compacted[index];
    }
  }
  return nodes;
}

/**
 * Build deterministic vertical alignment paths. Every node has at most one
 * aligned predecessor and successor, and a block never contains two nodes
 * from the same layer. The selected predecessor is the median by established
 * layer order, matching the core BK alignment preference.
 */
export function buildAlignmentBlocks(nodes, edges, levelKeys, options = {}) {
  const layerDirection = options.layerDirection === "backward" ? "backward" : "forward";
  const withinLayerDirection = options.withinLayerDirection === "backward" ? "backward" : "forward";
  const nodeById = new Map((nodes || []).map((node) => [node.id, node]));
  const nodesByLevel = groupNodesByLevel(nodes || []);
  const rankById = new Map();
  for (const level of levelKeys || []) {
    orderedLayer(nodesByLevel.get(level), withinLayerDirection)
      .forEach((node, rank) => rankById.set(node.id, rank));
  }
  const incomingByTarget = new Map();
  const outgoingBySource = new Map();
  const outgoingCount = new Map();
  for (const edge of edges || []) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    outgoingCount.set(edge.source, (outgoingCount.get(edge.source) || 0) + 1);
  }
  for (const edge of [...(edges || [])].toSorted(compareEdges)) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target || target.level - source.level !== 1) continue;
    if (!isAlignmentBlockNode(source) || !isAlignmentBlockNode(target)) continue;
    // A fanout source must remain a soft median preference. Binding it to one
    // arbitrary branch would make the result dependent on which load wins the
    // alignment slot and breaks the shared trunk's visual symmetry.
    if (outgoingCount.get(edge.source) !== 1) continue;
    if (!incomingByTarget.has(target.id)) incomingByTarget.set(target.id, []);
    incomingByTarget.get(target.id).push(edge);
    if (!outgoingBySource.has(source.id)) outgoingBySource.set(source.id, []);
    outgoingBySource.get(source.id).push(edge);
  }

  const nextBySource = new Map();
  const previousByTarget = new Map();
  const alignedEdges = [];
  const traversalLevels = layerDirection === "backward"
    ? [...(levelKeys || [])].reverse()
    : [...(levelKeys || [])];
  for (const level of traversalLevels) {
    const layer = orderedLayer(nodesByLevel.get(level), withinLayerDirection);
    if (layerDirection === "forward") {
      for (const target of layer) {
        const candidates = sortAlignmentCandidates(
          incomingByTarget.get(target.id),
          (edge) => rankById.get(edge.source)
        );
        const edge = chooseMedianCandidate(candidates, (candidate) =>
          !nextBySource.has(candidate.source) && !previousByTarget.has(candidate.target));
        if (edge) commitAlignment(edge, nextBySource, previousByTarget, alignedEdges);
      }
    } else {
      for (const source of layer) {
        const candidates = sortAlignmentCandidates(
          outgoingBySource.get(source.id),
          (edge) => rankById.get(edge.target)
        );
        const edge = chooseMedianCandidate(candidates, (candidate) =>
          !nextBySource.has(candidate.source) && !previousByTarget.has(candidate.target));
        if (edge) commitAlignment(edge, nextBySource, previousByTarget, alignedEdges);
      }
    }
  }

  const alignedNodeIds = new Set(alignedEdges.flatMap((edge) => [edge.source, edge.target]));
  const starts = [...alignedNodeIds]
    .filter((id) => !previousByTarget.has(id))
    .sort((left, right) => compareNodes(nodeById.get(left), nodeById.get(right)));
  const blocks = [];
  const blockByNodeId = new Map();
  for (const startId of starts) {
    const members = [];
    const levels = new Set();
    let nodeId = startId;
    let offset = 0;
    while (nodeId && !levels.has(nodeById.get(nodeId)?.level)) {
      const node = nodeById.get(nodeId);
      if (!node) break;
      members.push({ nodeId, level: node.level, offset: round(offset) });
      levels.add(node.level);
      const edge = nextBySource.get(nodeId);
      if (!edge) break;
      const target = nodeById.get(edge.target);
      offset += portOffset(node, edge.sourcePin, "source") -
        portOffset(target, edge.targetPin, "target");
      nodeId = edge.target;
    }
    if (members.length < 2) continue;
    const block = { id: `alignment:${startId}`, members };
    blocks.push(block);
    for (const member of members) blockByNodeId.set(member.nodeId, block);
  }
  return { blocks, blockByNodeId, alignedEdges };
}

export function chooseBestPlacementCandidate(baseNodes, candidates, edges, { gap = 8 } = {}) {
  const base = summarizePlacement(baseNodes, edges);
  const centerTolerance = Math.max(gap * 2, base.centerSpread * 0.05);
  let selectedNodes = baseNodes;
  let selectedSummary = base;
  let selectedIndex = -1;
  for (const [index, nodes] of (candidates || []).entries()) {
    const summary = summarizePlacement(nodes, edges);
    if (summary.centerSpread > base.centerSpread + centerTolerance) continue;
    if (summary.score >= selectedSummary.score - 0.001) continue;
    selectedNodes = nodes;
    selectedSummary = summary;
    selectedIndex = index;
  }
  return { nodes: selectedNodes, summary: selectedSummary, selectedIndex, base };
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

/**
 * Compare two completed placement candidates without using fixture identity.
 * A candidate that materially worsens the shared column axis is rejected even
 * when another scalar metric improves; this protects wide high-fanout layers.
 */
export function chooseBalancedPlacement(legacyNodes, candidateNodes, edges, { gap = 8 } = {}) {
  const legacy = summarizePlacement(legacyNodes, edges);
  const candidate = summarizePlacement(candidateNodes, edges);
  const centerTolerance = Math.max(gap * 2, legacy.centerSpread * 0.05);
  const centerRegression = candidate.centerSpread > legacy.centerSpread + centerTolerance;
  const scoreImprovement = candidate.score < legacy.score - 0.001;
  return {
    nodes: !centerRegression && scoreImprovement ? candidateNodes : legacyNodes,
    selected: !centerRegression && scoreImprovement ? "balanced" : "legacy",
    legacy,
    candidate,
    reason: centerRegression
      ? "column-center-regression"
      : scoreImprovement ? "lower-placement-score" : "no-score-improvement"
  };
}

export function summarizePlacement(nodes, edges) {
  if (!nodes?.length) return {
    height: 0,
    centerSpread: 0,
    portDelta: 0,
    alignedEdgeCount: 0,
    score: 0
  };
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const layers = groupNodesByLevel(nodes);
  const centers = [...layers.values()].map((layer) => {
    const top = Math.min(...layer.map((node) => node.y));
    const bottom = Math.max(...layer.map((node) => node.y + node.height));
    return (top + bottom) / 2;
  });
  const top = Math.min(...nodes.map((node) => node.y));
  const bottom = Math.max(...nodes.map((node) => node.y + node.height));
  let portDelta = 0;
  let alignedEdgeCount = 0;
  for (const edge of edges || []) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target || source.level === target.level) continue;
    const sourceY = source.y + portOffset(source, edge.sourcePin, "source");
    const targetY = target.y + portOffset(target, edge.targetPin, "target");
    const delta = Math.abs(sourceY - targetY);
    portDelta += delta;
    if (delta <= 0.5) alignedEdgeCount += 1;
  }
  const height = bottom - top;
  const centerSpread = Math.max(...centers) - Math.min(...centers);
  return {
    height: round(height),
    centerSpread: round(centerSpread),
    portDelta: round(portDelta),
    alignedEdgeCount,
    score: round(height * 4 + centerSpread * 2 + portDelta)
  };
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

function preferredYsByBlock(blocks, nodeById) {
  const preferred = new Map();
  for (const block of blocks || []) {
    const anchors = block.members
      .map((member) => {
        const node = nodeById.get(member.nodeId);
        return node ? node.y - member.offset : null;
      })
      .filter(Number.isFinite)
      .sort((left, right) => left - right);
    if (anchors.length === 0) continue;
    const middle = Math.floor(anchors.length / 2);
    const anchor = anchors.length % 2 === 1
      ? anchors[middle]
      : (anchors[middle - 1] + anchors[middle]) / 2;
    for (const member of block.members) preferred.set(member.nodeId, round(anchor + member.offset));
  }
  return preferred;
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

function orderedLayer(nodes, direction) {
  const ordered = [...(nodes || [])].toSorted(compareNodes);
  return direction === "backward" ? ordered.reverse() : ordered;
}

function sortAlignmentCandidates(edges, rankFor) {
  return [...(edges || [])].toSorted((left, right) =>
    finiteOr(rankFor(left), Number.MAX_SAFE_INTEGER) -
      finiteOr(rankFor(right), Number.MAX_SAFE_INTEGER) || compareEdges(left, right));
}

function chooseMedianCandidate(candidates, predicate) {
  if (!candidates.length) return null;
  const middle = Math.floor((candidates.length - 1) / 2);
  return medianOutward(candidates, middle).find(predicate) || null;
}

function commitAlignment(edge, nextBySource, previousByTarget, alignedEdges) {
  nextBySource.set(edge.source, edge);
  previousByTarget.set(edge.target, edge);
  alignedEdges.push(edge);
}

function medianOutward(values, middle) {
  const result = [];
  for (let distance = 0; result.length < values.length; distance += 1) {
    const lower = middle - distance;
    const upper = middle + distance + (values.length % 2 === 0 ? 1 : 0);
    if (lower >= 0) result.push(values[lower]);
    if (upper < values.length && upper !== lower) result.push(values[upper]);
  }
  return result;
}

function finiteOr(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : Number(fallback) || 0;
}

function isAlignmentBlockNode(node) {
  return node?.kind === "cell" || node?.kind === "assign";
}
