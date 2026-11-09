// Pure local-x measurement over already measured ports/margins. No placement,
// routing slots, layer offsets, or future phase state is consumed here.
export function measureLayerAlignment(input) {
  const nodes = new Map(input.nodes.map(node => [node.id, node]));
  const incident = new Map(input.nodes.flatMap(node => node.ports.map(port =>
    [port.id, {incoming: 0, outgoing: 0}])));
  for (const edge of input.edges) {
    incident.get(edge.sourcePortId).outgoing++;
    incident.get(edge.targetPortId).incoming++;
  }
  const layerWidths = input.layers.map(layer => Math.max(0, ...layer.nodeIds.map(id => {
    const node = nodes.get(id);
    return node.width + node.margins.left + node.margins.right;
  })));
  const offsets = new Map();
  input.layers.forEach((layer, index) => {
    const width = layerWidths[index];
    let maximumLeft = 0, maximumRight = 0;
    for (const id of layer.nodeIds) {
      const node = nodes.get(id);
      maximumLeft = Math.max(maximumLeft, node.margins.left);
      maximumRight = Math.max(maximumRight, node.margins.right);
    }
    for (const id of layer.nodeIds) {
      const node = nodes.get(id);
      let incoming = 0, outgoing = 0;
      for (const port of node.ports) {
        incoming += Number(incident.get(port.id).incoming > 0);
        outgoing += Number(incident.get(port.id).outgoing > 0);
      }
      const ratio = incoming + outgoing ? outgoing / (incoming + outgoing) : 0.5;
      let x = (width - node.width) * ratio;
      if (ratio > 0.5) x -= maximumRight * 2 * (ratio - 0.5);
      else if (ratio < 0.5) x += maximumLeft * 2 * (0.5 - ratio);
      offsets.set(id, Math.max(node.margins.left, Math.min(x, width - node.margins.right - node.width)));
    }
  });
  return {layerWidths, offsets};
}
