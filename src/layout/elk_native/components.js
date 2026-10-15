import { compareIds } from './protocol.js';

export function connectedComponents(nodes, edges) {
  const adjacent = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    adjacent.get(edge.sourceNodeId).push(edge.targetNodeId);
    adjacent.get(edge.targetNodeId).push(edge.sourceNodeId);
  }
  const visited = new Set(), components = [];
  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    const queue = [node.id]; visited.add(node.id);
    for (let cursor = 0; cursor < queue.length; cursor++) {
      for (const id of adjacent.get(queue[cursor])) if (!visited.has(id)) {
        visited.add(id); queue.push(id);
      }
    }
    components.push(queue.sort(compareIds));
  }
  // ELK processes the largest component first. Remaining equal sizes use stable identities.
  return components.sort((a, b) => b.length - a.length || compareIds(a[0], b[0]));
}
