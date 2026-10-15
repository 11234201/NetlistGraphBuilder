import { freezeRecord, checkCancelled } from './protocol.js';
import { validateP1 } from './validate_p1.js';
import { validateP2 } from './validate_p2.js';
import { connectedComponents } from './components.js';
import { optimizeRanks } from './network_simplex.js';

export function assignLayers(input, { signal } = {}) {
  validateP1(input);
  const ranks = new Map(), evidence = [], previousProfile = [];
  const components = connectedComponents(input.nodes, input.edges);
  const componentByNode = new Map(components.flatMap((ids, index) => ids.map((id) => [id, index])));
  const edgesByComponent = components.map(() => []);
  for (const edge of input.edges) edgesByComponent[componentByNode.get(edge.sourceNodeId)].push(edge);
  for (const [index, component] of components.entries()) {
    checkCancelled(signal);
    const edges = edgesByComponent[index];
    const result = optimizeRanks(component, edges, input.options, previousProfile, { signal });
    evidence.push(result.evidence);
    for (const [id, rank] of result.ranks) {
      ranks.set(id, rank); previousProfile[rank] = (previousProfile[rank] ?? 0) + 1;
    }
  }
  const nodes = input.nodes.map((node) => ({ ...node, layer: ranks.get(node.id) }));
  const layers = Array.from({ length: nodes.length ? Math.max(...ranks.values()) + 1 : 0 },
    (_, index) => ({ index, nodeIds: [] }));
  for (const node of nodes) layers[node.layer].nodeIds.push(node.id);
  const result = { ...input, phase: 'p2', nodes, layers, phaseData: {
    optimal:evidence.every((component)=>component.optimal),
    objectiveWeightedSpan: evidence.reduce((sum, component) => sum + component.objectiveWeightedSpan, 0),
    components: evidence } };
  validateP2(result);
  return freezeRecord(result);
}
