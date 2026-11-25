import { compareIds } from './protocol.js';

const boundaryGroupCache=new WeakMap();
const zeroInLayerCache=new WeakMap();
const frozenData=(record,keys)=>Object.isFrozen(record)&&keys.every(key=>
  Object.hasOwn(Object.getOwnPropertyDescriptor(record,key)??{},'value'));
const staticEdge=(edge)=>Object.isFrozen(edge)&&['id','sourcePortId','targetPortId']
  .every((key)=>Object.hasOwn(Object.getOwnPropertyDescriptor(edge,key)??{},'value'));

class Fenwick {
  constructor(size) { this.tree = new Float64Array(size + 2); this.counts = new Float64Array(size + 1); this.size = 0; }
  add(position, count) {
    this.counts[position] += count; this.size += count;
    for (let i = position + 1; i < this.tree.length; i += i & -i) this.tree[i] += count;
  }
  below(position) { let sum = 0; for (let i = position; i > 0; i -= i & -i) sum += this.tree[i]; return sum; }
  clearAt(position) { this.add(position, -this.counts[position]); }
}

export function crossingContext(graph, { cacheMutableQueries = true } = {}) {
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
  const context={ nodes, incoming, outgoing, incident, boundaries };
  if (!cacheMutableQueries) return context;
  const cache=new Map();
  for(const edges of boundaries)if(edges.every(staticEdge)){
    cache.set(edges,{members:[...edges],groups:buildBoundaryGroups(edges)});
  }
  boundaryGroupCache.set(context,cache);
  // A complete inter-layer-only incidence has exactly zero in-layer score.
  // Scratch arrays remain mutable; every reference/member is guarded at use.
  if(graph.nodes.every(node=>frozenData(node,['id','ports'])&&Object.isFrozen(node.ports)
    &&node.ports.every(port=>frozenData(port,['id','side'])))
    &&[...incident.values()].every(edges=>edges.every(edge=>frozenData(edge,['segmentKind'])&&edge.segmentKind==='inter_layer'))){
    zeroInLayerCache.set(context,{nodes:[...nodes],incident:[...incident].map(([id,edges])=>({id,edges,members:[...edges]}))});
  }
  return context;
}

function hasZeroInLayerScore(context,layers){
  const cached=zeroInLayerCache.get(context);
  return !!cached&&context.nodes.size===cached.nodes.length&&context.incident.size===cached.incident.length
    &&cached.nodes.every(([id,node])=>context.nodes.get(id)===node)
    &&cached.incident.every(({id,edges,members})=>context.incident.get(id)===edges&&edges.length===members.length
      &&members.every((edge,index)=>edges[index]===edge))
    &&layers.every(ids=>ids.every(id=>context.nodes.has(id)));
}

// Shared-port connected hyperedges, not logical-edge multiplicity. Independent DSU formulation.
function buildBoundaryGroups(edges) {
  const sources = new Set(edges.map((edge) => edge.sourcePortId)), targets = new Set(edges.map((edge) => edge.targetPortId));
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
    group.left.add(edge.sourcePortId); group.right.add(edge.targetPortId);
    groups.set(id, group);
  }
  return {sources,targets,groups:[...groups.values()]};
}

function hyperedgeScore(left, right, edges, context) {
  if (!edges.length) return 0;
  const cached=boundaryGroupCache.get(context)?.get(edges);
  const topology=cached&&cached.members.length===edges.length&&cached.members.every((edge,index)=>edge===edges[index])
    ?cached.groups:buildBoundaryGroups(edges);
  const sourceRanks = new Map(), targetRanks = new Map();
  for (const id of left) for (const port of context.nodes.get(id).ports) {
    if (topology.sources.has(port.id)) sourceRanks.set(port.id, sourceRanks.size);
  }
  for (const id of right) {
    const ports = context.nodes.get(id).ports;
    for (let index = ports.length - 1; index >= 0; index--) {
      const portId = ports[index].id;
      if (topology.targets.has(portId)) targetRanks.set(portId, targetRanks.size);
    }
  }
  const boxes = topology.groups.map((group) => {
    let upperLeft = Infinity, lowerLeft = -Infinity, upperRight = Infinity, lowerRight = -Infinity;
    for (const id of group.left) {
      const rank = sourceRanks.get(id);
      upperLeft = Math.min(upperLeft, rank); lowerLeft = Math.max(lowerLeft, rank);
    }
    for (const id of group.right) {
      const rank = targetRanks.get(id);
      upperRight = Math.min(upperRight, rank); lowerRight = Math.max(lowerRight, rank);
    }
    return { key: group.key, upperLeft, lowerLeft, upperRight, lowerRight };
  });
  return scoreBoxes(boxes, targetRanks.size);
}

function scoreBoxes(boxes, targetCount) {
  boxes.sort((a, b) => a.upperLeft - b.upperLeft || a.upperRight - b.upperRight || compareIds(a.key, b.key));
  const tree = new Fenwick(targetCount);
  let score = 0;
  for (const box of boxes) { score += tree.size - tree.below(box.upperRight + 1); tree.add(box.upperRight, 1); }
  for (const side of ['Left', 'Right']) {
    if (boxes.every((box) => box[`upper${side}`] === box[`lower${side}`])) continue;
    const corners = boxes.flatMap((box) => [
      { key: box.key, pos: box[`upper${side}`], other: box[`lower${side}`], lower: false },
      { key: box.key, pos: box[`lower${side}`], other: box[`upper${side}`], lower: true }]);
    corners.sort((a, b) => a.pos - b.pos || a.other - b.other || compareIds(a.key, b.key) || Number(a.lower) - Number(b.lower));
    let open = 0;
    for (const corner of corners) { if (corner.lower) score += --open; else open++; }
  }
  return score;
}

// orderLayers owns this context throughout all of its synchronous sweeps. Only
// layer order changes: ports and connected groups can therefore be indexed once.
export function createSweepCrossingCounter(graph, context) {
  const counters = context.boundaries.map((edges, index) => {
    if (!edges.length) return () => 0;
    const topology = boundaryGroupCache.get(context)?.get(edges)?.groups ?? buildBoundaryGroups(edges);
    const leftGroup = new Map(), rightGroup = new Map();
    topology.groups.forEach((group, ordinal) => {
      for (const id of group.left) leftGroup.set(id, ordinal);
      for (const id of group.right) rightGroup.set(id, ordinal);
    });
    const portGroups = (layer, groups, reverse) => {
      const byNode = new Map();
      for (const id of layer.nodeIds) {
        const ordinals = [];
        for (const port of context.nodes.get(id).ports) {
          const ordinal = groups.get(port.id);
          if (ordinal !== undefined) ordinals.push(ordinal);
        }
        byNode.set(id, reverse ? ordinals.reverse() : ordinals);
      }
      return byNode;
    };
    const leftByNode = portGroups(graph.layers[index], leftGroup, false);
    const rightByNode = portGroups(graph.layers[index + 1], rightGroup, true);
    return (left, right) => {
      const boxes = topology.groups.map(({ key }) => ({
        key, upperLeft: Infinity, lowerLeft: -Infinity, upperRight: Infinity, lowerRight: -Infinity
      }));
      let rank = 0;
      for (const id of left) for (const ordinal of leftByNode.get(id)) {
        const box = boxes[ordinal];
        if (box.upperLeft === Infinity) box.upperLeft = rank;
        box.lowerLeft = rank++;
      }
      rank = 0;
      for (const id of right) for (const ordinal of rightByNode.get(id)) {
        const box = boxes[ordinal];
        if (box.upperRight === Infinity) box.upperRight = rank;
        box.lowerRight = rank++;
      }
      return scoreBoxes(boxes, rank);
    };
  });
  const hasInLayer = graph.edges.some((edge) => edge.segmentKind !== 'inter_layer');
  return (layers) => {
    let score = 0;
    for (let i = 0; i < counters.length; i++) score += counters[i](layers[i], layers[i + 1]);
    if (hasInLayer) for (const layer of layers) for (const side of ['WEST', 'EAST']) score += inLayerScore(layer, side, context);
    return score;
  };
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
  if(!hasZeroInLayerScore(context,layers))for (const layer of layers) for (const side of ['WEST', 'EAST']) score += inLayerScore(layer, side, context);
  return score;
}
