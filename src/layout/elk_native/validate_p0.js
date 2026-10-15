import { PhaseError } from './protocol.js';

export function validateP0(graph) {
  const ids = new Set();
  const ports = new Map();
  for (const node of graph.nodes) {
    if (!node.id || ids.has(node.id)) throw new PhaseError('p0', 'duplicate-node-id', [node.id]);
    ids.add(node.id);
    if (![node.width, node.height, ...Object.values(node.margins)].every((v) =>
      typeof v === 'number' && Number.isFinite(v) && v >= 0)) {
      throw new PhaseError('p0', 'invalid-node-size', [node.id]);
    }
    for (const port of node.ports) {
      if (!port.id || ports.has(port.id)) throw new PhaseError('p0', 'duplicate-port-id', [port.id]);
      if (port.nodeId !== node.id || !['NORTH', 'EAST', 'SOUTH', 'WEST'].includes(port.side)
        || ![port.x, port.y, port.width, port.height, port.anchor.x, port.anchor.y].every(Number.isFinite)
        || port.width < 0 || port.height < 0) throw new PhaseError('p0', 'invalid-port', [port.id]);
      ports.set(port.id, port);
    }
  }
  const edgeIds = new Set();
  for (const edge of [...graph.edges, ...graph.selfLoops]) {
    if (typeof edge.id !== 'string' || !edge.id || edgeIds.has(edge.id)) throw new PhaseError('p0', 'duplicate-edge-id', [edge.id]);
    edgeIds.add(edge.id);
    const source = ports.get(edge.sourcePortId), target = ports.get(edge.targetPortId);
    if (!source || !target) throw new PhaseError('p0', 'missing-endpoint-port', [edge.id]);
    if (source.nodeId !== edge.sourceNodeId || target.nodeId !== edge.targetNodeId) {
      throw new PhaseError('p0', 'port-owner-mismatch', [edge.id]);
    }
    if (typeof edge.physicalNetId !== 'string' || !edge.physicalNetId
      || !Number.isFinite(edge.thickness) || edge.thickness < 0
      || !Number.isSafeInteger(edge.minimumLength) || edge.minimumLength < 1
      || !Number.isSafeInteger(edge.directionPriority) || !Number.isFinite(edge.weight) || edge.weight <= 0) {
      throw new PhaseError('p0', 'invalid-edge-policy', [edge.id]);
    }
  }
  return graph;
}
