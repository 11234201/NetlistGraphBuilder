// Deliberately quadratic, bounded TEST-ONLY geometry-free reference. No Fenwick or sweep implementation.
export function referenceCrossings(graph) {
  if (graph.nodes.length > 100) throw new Error('bounded crossing reference: at most 100 nodes');
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  let count = 0;
  for (let boundary = 0; boundary < graph.layers.length - 1; boundary++) {
    const edges = graph.edges.filter((edge) => edge.segmentKind === 'inter_layer' && nodes.get(edge.sourceNodeId).layer === boundary);
    const connected = (a, b) => a.sourcePortId === b.sourcePortId || a.targetPortId === b.targetPortId;
    const groups = [];
    const remaining = new Set(edges);
    while (remaining.size) {
      const group = [remaining.values().next().value]; remaining.delete(group[0]);
      for (let i = 0; i < group.length; i++) for (const edge of remaining) if (connected(group[i], edge)) {
        group.push(edge); remaining.delete(edge);
      }
      groups.push(group);
    }
    const positions = (layer, reverse) => new Map(graph.layers[layer].nodeIds.flatMap((id) =>
      (reverse ? [...nodes.get(id).ports].reverse() : nodes.get(id).ports).map((port) => port.id))
      .map((id, i) => [id, i]));
    const left = positions(boundary, false), right = positions(boundary + 1, true);
    const boxes = groups.map((group) => ({ l: group.map((edge) => left.get(edge.sourcePortId)),
      r: group.map((edge) => right.get(edge.targetPortId)) }));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if ((Math.min(...a.l) - Math.min(...b.l)) * (Math.min(...a.r) - Math.min(...b.r)) < 0) count++;
      for (const side of ['l', 'r']) if (Math.min(...a[side]) < Math.max(...b[side])
        && Math.min(...b[side]) < Math.max(...a[side])) count++;
    }
  }
  for (const layer of graph.layers) for (const side of ['WEST', 'EAST']) {
    const ids = layer.nodeIds.flatMap((id) => {
      const ports = nodes.get(id).ports.filter((port) => port.side === side);
      return (side === 'WEST' ? ports.reverse() : ports).map((port) => port.id);
    });
    const positions = new Map(ids.map((id, i) => [id, i]));
    const local = graph.edges.filter((edge) => edge.segmentKind === 'inverted_port'
      && positions.has(edge.sourcePortId) && positions.has(edge.targetPortId))
      .map((edge) => [positions.get(edge.sourcePortId), positions.get(edge.targetPortId)].sort((a,b) => a-b));
    for (let i = 0; i < local.length; i++) for (let j = i + 1; j < local.length; j++) {
      const [a,b] = local[i], [c,d] = local[j];
      if (a < c && c < b && b < d || c < a && a < d && d < b) count++;
    }
    for (const [a,b] of local) for (const edge of graph.edges.filter((entry) => entry.segmentKind === 'inter_layer')) {
      for (const id of [edge.sourcePortId, edge.targetPortId]) if (positions.get(id) > a && positions.get(id) < b) count++;
    }
  }
  return count;
}
