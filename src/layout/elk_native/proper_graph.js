import { compareIds, freezeRecord, checkCancelled } from './protocol.js';
import { validateP2 } from './validate_p2.js';
import { validateProperGraph } from './validate_proper.js';

// Independently structured from LongEdgeSplitter/InvertedPortProcessor (pinned ELK source).
// Generated identities encode topology, never insertion counters or geometry.
export function buildProperGraph(input, { signal, invertedPorts = true } = {}) {
  validateP2(input);
  const nodes = [...input.nodes], edges = [], chains = [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const portById = new Map(nodes.flatMap((node) => node.ports.map((port) => [port.id, port])));
  const makeDummy = (edge, layer, role) => {
    const id = `dummy:${JSON.stringify([edge.id, layer, role])}`;
    const height = role === 'span' ? edge.thickness : 0;
    const node = { id, kind: 'long_edge', dummyRole: role, displayName: '', layer,
      width: 0, height, margins: { top: 0, right: 0, bottom: 0, left: 0 },
      portConstraints: 'FIXED_POS', lineage: [edge.id],
      longEdgeSourcePortId: edge.sourcePortId, longEdgeTargetPortId: edge.targetPortId,
      ports: ['WEST', 'EAST'].map((side, order) => ({ id: `${id}:${side}`, nodeId: id,
        side, order, declaredOrder: null, x: 0, y: Math.floor(height / 2),
        width: 0, height: 0, anchor: { x: 0, y: 0 }, lineage: [edge.id] })) };
    nodes.push(node); nodeById.set(id, node);
    for (const port of node.ports) portById.set(port.id, port);
    return node;
  };
  for (const edge of input.edges) {
    checkCancelled(signal);
    const source = nodeById.get(edge.sourceNodeId), target = nodeById.get(edge.targetNodeId);
    const dummies = [];
    if (invertedPorts && portById.get(edge.sourcePortId).side === 'WEST') {
      dummies.push(makeDummy(edge, source.layer, 'source_inverted'));
    }
    for (let layer = source.layer + 1; layer < target.layer; layer++) dummies.push(makeDummy(edge, layer, 'span'));
    if (invertedPorts && portById.get(edge.targetPortId).side === 'EAST') {
      dummies.push(makeDummy(edge, target.layer, 'target_inverted'));
    }
    const segmentIds = [];
    for (let index = 0; index <= dummies.length; index++) {
      const sourcePortId = index === 0 ? edge.sourcePortId : dummies[index - 1].ports[1].id;
      const targetPortId = index === dummies.length ? edge.targetPortId : dummies[index].ports[0].id;
      const sourceNodeId = portById.get(sourcePortId).nodeId, targetNodeId = portById.get(targetPortId).nodeId;
      const sameLayer = nodeById.get(sourceNodeId).layer === nodeById.get(targetNodeId).layer;
      const id = `segment:${JSON.stringify([edge.id, index])}`;
      edges.push({ ...edge, id, sourcePortId, targetPortId, sourceNodeId, targetNodeId,
        minimumLength: sameLayer ? 0 : 1, segmentIndex: index,
        segmentKind: sameLayer ? 'inverted_port' : 'inter_layer' });
      segmentIds.push(id);
    }
    chains.push({ logicalEdgeId: edge.id, segmentIds, dummyNodeIds: dummies.map((node) => node.id) });
  }
  nodes.sort((a, b) => compareIds(a.id, b.id));
  edges.sort((a, b) => compareIds(a.id, b.id));
  const layers = input.layers.map((layer) => ({ index: layer.index, nodeIds: [] }));
  for (const node of nodes) layers[node.layer].nodeIds.push(node.id);
  const result = { ...input, phase: 'proper', nodes, edges, layers,
    logicalEdges: input.edges, chains, phaseData: { dummyCount: nodes.length - input.nodes.length,
      segmentCount: edges.length, invertedPorts } };
  validateProperGraph(result);
  return freezeRecord(result);
}
