import { compareIds, freezeRecord, checkCancelled } from './protocol.js';
import { validateProperGraph } from './validate_proper.js';

export function mergeHyperedgeDummies(input, { signal } = {}) {
  validateProperGraph(input);
  const nodes = new Map(input.nodes.map((node) => [node.id, { ...node, ports: node.ports.map((port) => ({ ...port })) }]));
  const parent = new Map(input.nodes.flatMap((node) => node.ports.map((port) => [port.id, port.id])));
  const root = (id) => { let current = id; while (parent.get(current) !== current) current = parent.get(current);
    while (parent.get(id) !== id) { const next = parent.get(id); parent.set(id, current); id = next; } return current; };
  const union = (a,b) => { const left = root(a), right = root(b); if (left !== right) parent.set(right,left); };
  for (const edge of input.edges) union(edge.sourcePortId, edge.targetPortId);
  for (const node of input.nodes) if (node.kind === 'long_edge') union(node.ports[0].id, node.ports[1].id);
  const logical = new Map(input.logicalEdges.map((edge) => [edge.id, edge]));
  const netByDummy = new Map(), lineageParts = new Map();
  for (const node of input.nodes) if (node.kind === 'long_edge') {
    const nets = new Set(node.lineage.map((id) => logical.get(id).physicalNetId));
    netByDummy.set(node.id, nets.size === 1 ? [...nets][0] : null);
    lineageParts.set(node.id, [node.lineage]);
  }
  const representatives = new Map(), portReplacements = new Map(), equivalences = [];
  const layers = input.layers.map((layer) => {
    const ids = [];
    for (const id of layer.nodeIds) {
      checkCancelled(signal);
      const current = nodes.get(id), previous = nodes.get(ids.at(-1));
      const sameNet = previous?.kind === 'long_edge' && current.kind === 'long_edge'
        && netByDummy.get(previous.id) !== null && netByDummy.get(previous.id) === netByDummy.get(current.id);
      if (sameNet && root(previous.ports[0].id) === root(current.ports[0].id)) {
        representatives.set(id, previous.id);
        portReplacements.set(current.ports[0].id, previous.ports[0].id);
        portReplacements.set(current.ports[1].id, previous.ports[1].id);
        lineageParts.get(previous.id).push(current.lineage);
        if (previous.longEdgeSourcePortId !== current.longEdgeSourcePortId) previous.longEdgeSourcePortId = null;
        if (previous.longEdgeTargetPortId !== current.longEdgeTargetPortId) previous.longEdgeTargetPortId = null;
        equivalences.push({ consumedNodeId: id, producedNodeId: previous.id, logicalEdgeIds: current.lineage,
          consumedPortIds: current.ports.map((port) => port.id), producedPortIds: previous.ports.map((port) => port.id) });
        nodes.delete(id);
      } else ids.push(id);
    }
    ids.forEach((id, order) => {
      const node = nodes.get(id); node.order = order;
      if (node.kind === 'long_edge') {
        node.lineage = [...new Set(lineageParts.get(id).flat())].sort(compareIds);
        for (const port of node.ports) port.lineage = node.lineage;
      }
    });
    return { index: layer.index, nodeIds: ids };
  });
  const ports = new Map([...nodes.values()].flatMap((node) => node.ports.map((port) => [port.id, port])));
  const edges = input.edges.map((edge) => {
    const sourcePortId = portReplacements.get(edge.sourcePortId) ?? edge.sourcePortId;
    const targetPortId = portReplacements.get(edge.targetPortId) ?? edge.targetPortId;
    return { ...edge, sourcePortId, targetPortId, sourceNodeId: ports.get(sourcePortId).nodeId, targetNodeId: ports.get(targetPortId).nodeId };
  });
  const chains = input.chains.map((chain) => ({ ...chain,
    dummyNodeIds: chain.dummyNodeIds.map((id) => representatives.get(id) ?? id) }));
  const result = { ...input, phase: 'hyperedge_merge', nodes: [...nodes.values()], layers, edges, chains,
    mergeEquivalences: equivalences, phaseData: { mergedDummyCount: equivalences.length } };
  validateProperGraph(result);
  return freezeRecord(result);
}
