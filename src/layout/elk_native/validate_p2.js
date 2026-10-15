import { PhaseError } from './protocol.js';
import { validateP1 } from './validate_p1.js';

export function validateP2(graph) {
  validateP1(graph);
  const ranks = new Map(graph.nodes.map((node) => [node.id, node.layer]));
  for (const [id, rank] of ranks) if (!Number.isSafeInteger(rank) || rank < 0) {
    throw new PhaseError('p2', 'invalid-rank', [id]);
  }
  for (const edge of graph.edges) if (ranks.get(edge.targetNodeId) - ranks.get(edge.sourceNodeId) < edge.minimumLength) {
    throw new PhaseError('p2', 'minimum-length', [edge.id]);
  }
  const layered = graph.layers.flatMap((layer) => layer.nodeIds);
  if (layered.length !== ranks.size || new Set(layered).size !== ranks.size) {
    throw new PhaseError('p2', 'layer-membership');
  }
  for (const layer of graph.layers) for (const id of layer.nodeIds) if (ranks.get(id) !== layer.index) {
    throw new PhaseError('p2', 'layer-rank-mismatch', [id]);
  }
  const objective = graph.edges.reduce((sum, edge) => sum
    + edge.weight * (ranks.get(edge.targetNodeId) - ranks.get(edge.sourceNodeId)), 0);
  if (Math.abs(objective - graph.phaseData.objectiveWeightedSpan) > 1e-10) {
    throw new PhaseError('p2', 'objective-mismatch');
  }
  return graph;
}
