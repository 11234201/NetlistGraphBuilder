import { CONTRACT_VERSION, PhaseError, compareIds, freezeRecord, checkCancelled } from './protocol.js';
import { inputDigest } from './input_digest.js';
import { normalizePolicy } from './policy.js';
import { validateP0 } from './validate_p0.js';

const sideOrder = { NORTH: 0, EAST: 1, SOUTH: 2, WEST: 3 };
const coordinate = (port) => ['WEST', 'SOUTH'].includes(port.side)
  ? -(port.side === 'WEST' ? port.y : port.x) : port.side === 'EAST' ? port.y : port.x;

export function createCanonicalGraph(input, policy = {}, { signal } = {}) {
  checkCancelled(signal);
  if (!Array.isArray(input?.nodes) || !Array.isArray(input?.edges)) throw new PhaseError('p0', 'invalid-graph');
  const options = normalizePolicy(policy);
  const nodes = input.nodes.map((node) => {
    if (typeof node.id !== 'string') throw new PhaseError('p0', 'invalid-node-id');
    const constraint = node.portConstraints ?? options.portConstraints;
    if (!['FIXED_POS', 'FIXED_ORDER'].includes(constraint)) {
      throw new PhaseError('p0', 'unsupported-port-constraints', [node.id]);
    }
    if (!Array.isArray(node.ports)) throw new PhaseError('p0', 'missing-ports', [node.id]);
    const ports = node.ports.map((port) => ({ id: port.id, nodeId: node.id,
      side: port.side, declaredOrder: port.order ?? null,
      x: port.x, y: port.y, width: port.width ?? 0, height: port.height ?? 0,
      ...(port.borderOffset === undefined ? {} : { borderOffset: port.borderOffset }),
      anchor: { x: port.anchor?.x ?? (port.width ?? 0) / 2,
        y: port.anchor?.y ?? (port.height ?? 0) / 2 } }));
    for (const port of ports) {
      if (typeof port.id !== 'string' || (port.declaredOrder !== null
        && !Number.isSafeInteger(port.declaredOrder))) throw new PhaseError('p0', 'invalid-port-order', [port.id]);
    }
    ports.sort((a, b) => sideOrder[a.side] - sideOrder[b.side]
      || (constraint === 'FIXED_ORDER' && a.declaredOrder !== null && b.declaredOrder !== null
        ? a.declaredOrder - b.declaredOrder : coordinate(a) - coordinate(b)) || compareIds(a.id, b.id));
    ports.forEach((port, order) => { port.order = order; });
    return { id: node.id, kind: node.kind ?? 'normal', displayName: node.displayName ?? node.id,
      width: node.width, height: node.height, portConstraints: constraint,
      margins: { top: node.margins?.top ?? 0, right: node.margins?.right ?? 0,
        bottom: node.margins?.bottom ?? 0, left: node.margins?.left ?? 0 }, ports };
  }).sort((a, b) => compareIds(a.id, b.id));
  const ports = new Map(nodes.flatMap((node) => node.ports.map((port) => [port.id, port])));
  const edges = input.edges.map((edge) => ({ id: edge.id, logicalEdgeId: edge.id,
    physicalNetId: edge.physicalNetId, sourcePortId: edge.sourcePortId, targetPortId: edge.targetPortId,
    originalSourcePortId: edge.sourcePortId, originalTargetPortId: edge.targetPortId,
    sourceNodeId: ports.get(edge.sourcePortId)?.nodeId, targetNodeId: ports.get(edge.targetPortId)?.nodeId,
    minimumLength: edge.minimumLength ?? 1, weight: edge.weight ?? 1, thickness: edge.thickness ?? 1,
    directionPriority: edge.directionPriority ?? 0, reversed: false,
    lineage: [edge.id] })).sort((a, b) => compareIds(a.id, b.id));
  const selfLoops = edges.filter((edge) => edge.sourceNodeId === edge.targetNodeId);
  const normalEdges = edges.filter((edge) => edge.sourceNodeId !== edge.targetNodeId);
  const physicalNets = new Map();
  for (const edge of edges) {
    const group = physicalNets.get(edge.physicalNetId) ?? [];
    group.push(edge.id);
    physicalNets.set(edge.physicalNetId, group);
  }
  const canonical = { contractVersion: CONTRACT_VERSION, nodes, edges: normalEdges, selfLoops,
    physicalNets: [...physicalNets].sort(([a], [b]) => compareIds(a, b))
      .map(([id, edgeIds]) => ({ id, edgeIds })), options };
  validateP0(canonical);
  return freezeRecord({ ...canonical, phase: 'p0', inputDigest: inputDigest(JSON.stringify(canonical)),
    phaseData: {} });
}
