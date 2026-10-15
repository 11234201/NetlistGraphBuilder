// The audited clockwise fixed-side distributor. Input WEST ranks run top-to-bottom
// by reversing the clockwise port order; both source-visible rank models are retained.
export function calculatePortRanks(ids, context, forward, model) {
  const ranks = new Map();
  let consumed = 0;
  const adjacency = forward ? context.outgoing : context.incoming;
  for (const id of ids) {
    const ports = context.nodes.get(id).ports.filter((port) => adjacency.get(port.id).length > 0);
    const increment = model === 'node_relative' ? 1 / (ports.length + 1) : 1;
    let position = forward ? consumed + increment : consumed + ports.length * increment;
    for (const port of ports) { ranks.set(port.id, position); position += forward ? increment : -increment; }
    consumed += model === 'node_relative' ? 1 : ports.length;
  }
  return ranks;
}
