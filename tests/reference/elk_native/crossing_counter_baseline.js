import { compareIds } from '../../../src/layout/elk_native/protocol.js';

class Fenwick {
  constructor(size) { this.tree = new Float64Array(size + 2); this.counts = new Float64Array(size + 1); this.size = 0; }
  add(position, count) {
    this.counts[position] += count; this.size += count;
    for (let i = position + 1; i < this.tree.length; i += i & -i) this.tree[i] += count;
  }
  below(position) { let sum = 0; for (let i = position; i > 0; i -= i & -i) sum += this.tree[i]; return sum; }
  clearAt(position) { this.add(position, -this.counts[position]); }
}

export function crossingContext(graph) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const incoming = new Map(), outgoing = new Map(), incident = new Map();
  for (const node of graph.nodes) for (const port of node.ports) {
    incoming.set(port.id, []); outgoing.set(port.id, []); incident.set(port.id, []);
  }
  const boundaries = Array.from({ length: Math.max(0, graph.layers.length - 1) }, () => []);
  for (const edge of graph.edges) {
    incoming.get(edge.targetPortId).push(edge); outgoing.get(edge.sourcePortId).push(edge);
    incident.get(edge.sourcePortId).push(edge); incident.get(edge.targetPortId).push(edge);
    if (edge.segmentKind === 'inter_layer') boundaries[nodes.get(edge.sourceNodeId).layer].push(edge);
  }
  return { nodes, incoming, outgoing, incident, boundaries };
}

// Shared-port connected hyperedges, not logical-edge multiplicity. Independent DSU formulation.
function hyperedgeScore(left, right, edges, context) {
  if (!edges.length) return 0;
  const sources = new Set(edges.map((edge) => edge.sourcePortId)), targets = new Set(edges.map((edge) => edge.targetPortId));
  const sourceRanks = new Map(), targetRanks = new Map();
  for (const id of left) for (const port of context.nodes.get(id).ports) {
    if (sources.has(port.id)) sourceRanks.set(port.id, sourceRanks.size);
  }
  for (const id of right) for (const port of [...context.nodes.get(id).ports].reverse()) {
    if (targets.has(port.id)) targetRanks.set(port.id, targetRanks.size);
  }
  const parent = new Map();
  const root = (id) => {
    if (!parent.has(id)) parent.set(id, id);
    let current = id;
    while (parent.get(current) !== current) current = parent.get(current);
    while (parent.get(id) !== id) { const next = parent.get(id); parent.set(id, current); id = next; }
    return current;
  };
  for (const edge of edges) {
    const source = root(edge.sourcePortId), target = root(edge.targetPortId);
    if (source !== target) parent.set(target, source);
  }
  const groups = new Map();
  for (const edge of edges) {
    const id = root(edge.sourcePortId);
    const group = groups.get(id) ?? { key: edge.id, left: new Set(), right: new Set() };
    group.left.add(sourceRanks.get(edge.sourcePortId)); group.right.add(targetRanks.get(edge.targetPortId));
    groups.set(id, group);
  }
  const boxes = [...groups.values()].map((group) => ({ key: group.key,
    upperLeft: Math.min(...group.left), lowerLeft: Math.max(...group.left),
    upperRight: Math.min(...group.right), lowerRight: Math.max(...group.right) }));
  boxes.sort((a, b) => a.upperLeft - b.upperLeft || a.upperRight - b.upperRight || compareIds(a.key, b.key));
  const tree = new Fenwick(targetRanks.size);
  let score = 0;
  for (const box of boxes) { score += tree.size - tree.below(box.upperRight + 1); tree.add(box.upperRight, 1); }
  for (const side of ['Left', 'Right']) {
    const corners = boxes.flatMap((box) => [
      { key: box.key, pos: box[`upper${side}`], other: box[`lower${side}`], lower: false },
      { key: box.key, pos: box[`lower${side}`], other: box[`upper${side}`], lower: true }]);
    corners.sort((a, b) => a.pos - b.pos || a.other - b.other || compareIds(a.key, b.key) || Number(a.lower) - Number(b.lower));
    let open = 0;
    for (const corner of corners) { if (corner.lower) score += --open; else open++; }
  }
  return score;
}

function inLayerScore(layer, side, context) {
  const ports = layer.flatMap((id) => {
    const matching = context.nodes.get(id).ports.filter((port) => port.side === side);
    return side === 'WEST' ? matching.reverse() : matching;
  });
  const ranks = new Map(ports.map((port, index) => [port.id, index]));
  const tree = new Fenwick(ports.length);
  let score = 0;
  for (const port of ports) {
    const position = ranks.get(port.id); tree.clearAt(position);
    const ends = []; let betweenCount = 0;
    for (const edge of context.incident.get(port.id)) {
      if (edge.segmentKind === 'inter_layer') betweenCount++;
      else {
        const other = edge.sourcePortId === port.id ? edge.targetPortId : edge.sourcePortId;
        const end = ranks.get(other);
        if (end > position) { score += tree.below(end); ends.push(end); }
      }
    }
    score += tree.size * betweenCount;
    for (const end of ends) tree.add(end, 1);
  }
  return score;
}

export function countCrossings(graph, layers = graph.layers.map((layer) => layer.nodeIds), context = crossingContext(graph)) {
  let score = 0;
  for (let i = 0; i < layers.length - 1; i++) score += hyperedgeScore(layers[i], layers[i + 1], context.boundaries[i], context);
  for (const layer of layers) for (const side of ['WEST', 'EAST']) score += inLayerScore(layer, side, context);
  return score;
}


