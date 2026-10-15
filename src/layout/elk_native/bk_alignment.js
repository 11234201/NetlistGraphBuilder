import { compareIds,PhaseError } from './protocol.js';

export function buildNeighborhood(graph) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const ports = new Map(graph.nodes.flatMap((node) => node.ports.map((port) => [port.id, port])));
  const position = new Map(graph.layers.flatMap((layer) => layer.nodeIds.map((id, order) => [id, order])));
  const left = new Map(graph.nodes.map((node) => [node.id, []])), right = new Map(graph.nodes.map((node) => [node.id, []]));
  const incident = new Map(graph.nodes.map((node) => [node.id, []]));
  for (const edge of graph.edges) {
    incident.get(edge.sourceNodeId).push(edge); incident.get(edge.targetNodeId).push(edge);
    if (edge.segmentKind === 'inter_layer') {
      left.get(edge.targetNodeId).push({ nodeId: edge.sourceNodeId, edge });
      right.get(edge.sourceNodeId).push({ nodeId: edge.targetNodeId, edge });
    }
  }
  // ThresholdStrategy consumes the first eligible incoming/outgoing edge in
  // node-port order. Global logical-edge order must not override P3's fixed
  // clockwise ports; canonical edge IDs resolve ties within one owned port.
  for (const [nodeId, entries] of incident) {
    const ownedPort = (edge) => ports.get(edge.sourceNodeId === nodeId ? edge.sourcePortId : edge.targetPortId);
    entries.sort((a, b) => ownedPort(a).order - ownedPort(b).order || compareIds(a.id, b.id));
  }
  for (const neighbors of [left, right]) for (const [id, entries] of neighbors) {
    const maximum = Math.max(0, ...entries.map(({ edge }) => edge.straightnessPriority ?? 0));
    neighbors.set(id, entries.filter(({ edge }) => (edge.straightnessPriority ?? 0) === maximum)
      .sort((a,b) => position.get(a.nodeId) - position.get(b.nodeId) || compareIds(a.edge.id,b.edge.id)));
  }
  const marked = new Set();
  const inner = (id) => nodes.get(id).kind === 'long_edge' && left.get(id).some(({ nodeId }) => nodes.get(nodeId).kind === 'long_edge');
  for (let layer = 2; layer < graph.layers.length; layer++) {
    const ids = graph.layers[layer].nodeIds;
    let lowerBound = 0, pending = 0;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i], isInner = inner(id);
      if (i === ids.length - 1 || isInner) {
        const upperBound = isInner ? position.get(left.get(id)[0].nodeId) : graph.layers[layer - 1].nodeIds.length - 1;
        while (pending <= i) {
          const candidate = ids[pending++];
          if (!inner(candidate)) for (const { nodeId, edge } of left.get(candidate)) {
            const index = position.get(nodeId);
            if (index < lowerBound || index > upperBound) marked.add(edge.id);
          }
        }
        lowerBound = upperBound;
      }
    }
  }
  return { graph, nodes, ports, position, left, right, incident, marked };
}

export function alignBlocks(context, horizontal, vertical) {
  const ids = context.graph.layers.flatMap((layer) => layer.nodeIds);
  const root = new Map(ids.map((id) => [id, id])), align = new Map(root), innerShift = new Map(ids.map((id) => [id, 0]));
  const alignmentEdges = new Map(), blockSize = new Map(), onlyDummies = new Map(ids.map((id) => [id, true]));
  const layers = horizontal === 'LEFT' ? [...context.graph.layers].reverse() : context.graph.layers;
  for (const layer of layers) {
    let boundary = vertical === 'UP' ? Infinity : -1;
    const members = vertical === 'UP' ? [...layer.nodeIds].reverse() : layer.nodeIds;
    for (const id of members) {
      const neighbors = (horizontal === 'LEFT' ? context.right : context.left).get(id);
      const low = Math.floor((neighbors.length - 1) / 2), high = Math.ceil((neighbors.length - 1) / 2);
      if (!neighbors.length) continue;
      const medians = vertical === 'UP' ? [high, low] : [low, high];
      for (const index of [...new Set(medians)]) {
        const { nodeId, edge } = neighbors[index], position = context.position.get(nodeId);
        if (align.get(id) === id && !context.marked.has(edge.id)
          && (vertical === 'UP' ? boundary > position : boundary < position)) {
          align.set(nodeId, id); root.set(id, root.get(nodeId)); align.set(id, root.get(id));
          alignmentEdges.set(nodeId, edge);
          onlyDummies.set(root.get(id), onlyDummies.get(root.get(id)) && context.nodes.get(id).kind === 'long_edge');
          boundary = position;
        }
      }
    }
  }
  const blocks = new Map();
  for (const id of ids) if (root.get(id) === id) {
    const members = [id],seen=new Set(members); let next = align.get(id);
    while (next !== id) {
      if(!context.nodes.has(next)||seen.has(next)||root.get(next)!==id)
        throw new PhaseError('p4','invalid-alignment-cycle',[id,next]);
      seen.add(next);members.push(next);next=align.get(next);
    }
    blocks.set(id, members);
    const node = context.nodes.get(id);
    let above = node.margins.top, below = node.height + node.margins.bottom;
    for (let i = 1; i < members.length; i++) {
      const previous = members[i - 1], current = members[i];
      const edge = alignmentEdges.get(previous);
      const source = context.ports.get(edge.sourcePortId), target = context.ports.get(edge.targetPortId);
      const difference = (source.y + source.anchor.y - target.y - target.anchor.y) * (horizontal === 'LEFT' ? -1 : 1);
      const shift = innerShift.get(previous) + difference;
      innerShift.set(current, shift);
      const member = context.nodes.get(current);
      above = Math.max(above, member.margins.top - shift);
      below = Math.max(below, shift + member.height + member.margins.bottom);
    }
    for (const current of members) innerShift.set(current, innerShift.get(current) + above);
    blockSize.set(id, above + below);
  }
  return { horizontal, vertical, root, align, innerShift, blockSize, blocks, onlyDummies, alignmentEdges };
}

export function verticalSpacing(a, b, options) {
  const dummyCount = Number(a.kind === 'long_edge') + Number(b.kind === 'long_edge');
  return dummyCount === 2 ? options.edgeEdgeSpacing : dummyCount === 1 ? options.edgeNodeSpacing : options.nodeNodeSpacing;
}
