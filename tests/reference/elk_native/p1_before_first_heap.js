import { compareIds, freezeRecord, checkCancelled } from '../../../src/layout/elk_native/protocol.js';
import { validateP0 } from '../../../src/layout/elk_native/validate_p0.js';
import { validateP1 } from '../../../src/layout/elk_native/validate_p1.js';

// Behavioral source: ELK p1cycles/GreedyCycleBreaker at pinned 28e5173.
// Adaptation: canonical ID ties replace incidental FIFO/RNG ties. Weighted degree
// counts parallel logical edges, including branches sharing a physical source port.
export function orientGraph(input, { signal } = {}) {
  validateP0(input);
  checkCancelled(signal);
  const ids = input.nodes.map((node) => node.id);
  const incident = new Map(ids.map((id) => [id, []]));
  const degrees = new Map(ids.map((id) => [id, { incoming: 0, outgoing: 0 }]));
  for (const edge of input.edges) {
    const weight = Math.max(0, edge.directionPriority) + 1;
    degrees.get(edge.sourceNodeId).outgoing += weight;
    degrees.get(edge.targetNodeId).incoming += weight;
    incident.get(edge.sourceNodeId).push({ edge, weight });
    incident.get(edge.targetNodeId).push({ edge, weight });
  }
  const pending = new Set(ids), sources = new Set(), sinks = new Set();
  const left = [], right = [], decisions = [];
  const classify = (id) => {
    if (!pending.has(id)) return;
    const degree = degrees.get(id);
    if (degree.outgoing === 0) { sinks.add(id); sources.delete(id); }
    else if (degree.incoming === 0) sources.add(id);
  };
  ids.forEach(classify);
  const remove = (id, role) => {
    const degree = degrees.get(id);
    decisions.push({ nodeId: id, role, outflow: degree.outgoing - degree.incoming });
    (role === 'sink' ? right : left).push(id);
    pending.delete(id);
    sources.delete(id); sinks.delete(id);
    for (const { edge, weight } of incident.get(id)) {
      const other = edge.sourceNodeId === id ? edge.targetNodeId : edge.sourceNodeId;
      if (!pending.has(other)) continue;
      degrees.get(other)[edge.sourceNodeId === id ? 'incoming' : 'outgoing'] -= weight;
      classify(other);
    }
  };
  const first = (set) => ids.find((id) => set.has(id));
  while (pending.size) {
    checkCancelled(signal);
    while (sinks.size) remove(first(sinks), 'sink');
    while (sources.size) remove(first(sources), 'source');
    if (pending.size) {
      let chosen, maximum = -Infinity;
      for (const id of pending) {
        const degree = degrees.get(id);
        const flow = degree.outgoing - degree.incoming;
        if (flow > maximum || (flow === maximum && compareIds(id, chosen) < 0)) {
          chosen = id; maximum = flow;
        }
      }
      remove(chosen, 'maximum-outflow');
    }
  }
  const order = [...left, ...right.reverse()];
  const position = new Map(order.map((id, index) => [id, index]));
  const feedbackEdges = [];
  const edges = input.edges.map((edge) => {
    const reversed = position.get(edge.sourceNodeId) > position.get(edge.targetNodeId);
    if (!reversed) return edge;
    feedbackEdges.push(edge.id);
    return { ...edge, sourceNodeId: edge.targetNodeId, targetNodeId: edge.sourceNodeId,
      sourcePortId: edge.targetPortId, targetPortId: edge.sourcePortId, reversed: !edge.reversed };
  });
  const output = { ...input, phase: 'p1', edges,
    phaseData: { order, decisions, feedbackEdges } };
  validateP1(output);
  return freezeRecord(output);
}
