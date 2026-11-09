import { PhaseError } from './protocol.js';

export function validateProperGraph(graph) {
  const fail = (code, ids = []) => { throw new PhaseError('proper', code, ids); };
  const nodes = new Map(), ports = new Map(), edges = new Map();
  for (const node of graph.nodes) {
    if (nodes.has(node.id)) fail('duplicate-node', [node.id]);
    nodes.set(node.id, node);
    for (const port of node.ports) {
      if (ports.has(port.id) || port.nodeId !== node.id) fail('invalid-port', [port.id]);
      ports.set(port.id, port);
    }
  }
  const layerMembers = new Set();
  for (const layer of graph.layers) for (const id of layer.nodeIds) {
    if (layerMembers.has(id) || nodes.get(id)?.layer !== layer.index) fail('invalid-layer-member', [id]);
    layerMembers.add(id);
  }
  if (layerMembers.size !== nodes.size) fail('missing-layer-member');
  for (const edge of graph.edges) {
    if (edges.has(edge.id)) fail('duplicate-segment', [edge.id]);
    edges.set(edge.id, edge);
    const source = ports.get(edge.sourcePortId), target = ports.get(edge.targetPortId);
    if (!source || !target || source.nodeId !== edge.sourceNodeId || target.nodeId !== edge.targetNodeId) {
      fail('invalid-endpoint', [edge.id]);
    }
    const span = nodes.get(target.nodeId).layer - nodes.get(source.nodeId).layer;
    if (span !== (edge.segmentKind === 'inverted_port' ? 0 : 1)) fail('invalid-span', [edge.id]);
    if (span === 0 && ![source, target].some((port) =>
      ['source_inverted', 'target_inverted'].includes(nodes.get(port.nodeId).dummyRole))) {
      fail('unowned-in-layer-segment', [edge.id]);
    }
  }
  const logical = new Map(graph.logicalEdges.map((edge) => [edge.id, edge]));
  const usedEdges = new Set(), usedDummies = new Set(), usedLogical = new Set();
  for (const chain of graph.chains) {
    const original = logical.get(chain.logicalEdgeId);
    if (!original || usedLogical.has(original.id) || chain.segmentIds.length !== chain.dummyNodeIds.length + 1) {
      fail('invalid-chain', [chain.logicalEdgeId]);
    }
    usedLogical.add(original.id);
    let currentPortId = original.sourcePortId;
    for (let index = 0; index < chain.segmentIds.length; index++) {
      const edge = edges.get(chain.segmentIds[index]);
      if (!edge || usedEdges.has(edge.id) || edge.sourcePortId !== currentPortId
        || edge.logicalEdgeId !== original.id || edge.physicalNetId !== original.physicalNetId
        || edge.reversed !== original.reversed || edge.originalSourcePortId !== original.originalSourcePortId
        || edge.originalTargetPortId !== original.originalTargetPortId
        || edge.lineage.length !== 1 || edge.lineage[0] !== original.id) fail('broken-lineage', [chain.logicalEdgeId]);
      usedEdges.add(edge.id);
      if (index < chain.dummyNodeIds.length) {
        const dummy = nodes.get(chain.dummyNodeIds[index]);
        if (!dummy || dummy.kind !== 'long_edge'
          || !dummy.lineage.includes(original.id)
          || edge.targetPortId !== dummy.ports[0].id) fail('broken-dummy-chain', [original.id]);
        usedDummies.add(dummy.id); currentPortId = dummy.ports[1].id;
      } else if (edge.targetPortId !== original.targetPortId) fail('broken-chain-target', [original.id]);
    }
  }
  if (usedEdges.size !== edges.size || usedLogical.size !== logical.size
    || usedDummies.size !== graph.nodes.filter((node) => node.kind === 'long_edge').length) fail('uncovered-lineage');
  return graph;
}
