import { PhaseError } from './protocol.js';
import { validateP0 } from './validate_p0.js';

export function validateP1(graph) {
  validateP0(graph);
  const indegree = new Map(graph.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, []]));
  for (const edge of graph.edges) {
    indegree.set(edge.targetNodeId, indegree.get(edge.targetNodeId) + 1);
    outgoing.get(edge.sourceNodeId).push(edge.targetNodeId);
    const expectedSource = edge.reversed ? edge.originalTargetPortId : edge.originalSourcePortId;
    const expectedTarget = edge.reversed ? edge.originalSourcePortId : edge.originalTargetPortId;
    if (edge.sourcePortId !== expectedSource || edge.targetPortId !== expectedTarget) {
      throw new PhaseError('p1', 'reversal-lineage-mismatch', [edge.id]);
    }
  }
  const queue = [...indegree].filter(([, degree]) => degree === 0).map(([id]) => id);
  let visited = 0;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const id = queue[cursor];
    visited++;
    for (const target of outgoing.get(id)) {
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  if (visited !== graph.nodes.length) throw new PhaseError('p1', 'working-cycle');
  return graph;
}
