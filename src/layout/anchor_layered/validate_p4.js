import { PhaseError } from './protocol.js';
import { validateProperGraph } from './validate_proper.js';
import { verticalSpacing } from './bk_alignment.js';

export function validateP4(graph) {
  validateProperGraph(graph);
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const node of graph.nodes) if (!Number.isFinite(node.y)) throw new PhaseError('p4', 'invalid-coordinate', [node.id]);
  for (const layer of graph.layers) for (let i = 1; i < layer.nodeIds.length; i++) {
    const above = nodes.get(layer.nodeIds[i - 1]), below = nodes.get(layer.nodeIds[i]);
    if (below.y - below.margins.top < above.y + above.height + above.margins.bottom
      + verticalSpacing(above, below, graph.options) - 1e-8) {
      throw new PhaseError('p4', 'spacing-order-violation', [above.id, below.id]);
    }
  }
  return graph;
}
