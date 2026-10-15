import { PhaseError } from './protocol.js';

// Extend scratch boundary adjacency only; never merge canonical port identities.
export function connectPhysicalAnchors(edges, ports, adjacency) {
  const anchors = new Map();
  for (const edge of edges) {
    if (typeof edge.physicalNetId !== 'string') {
      throw new PhaseError('p5', 'missing-physical-net', [edge.id]);
    }
    for (const id of [edge.sourcePortId, edge.targetPortId]) {
      const port = ports.get(id);
      if (!port || !adjacency.has(id)) {
        throw new PhaseError('p5', 'missing-boundary-port', [id]);
      }
      const x = port.x + port.anchor.x, y = port.y + port.anchor.y;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new PhaseError('p5', 'invalid-measured-anchor', [id]);
      }
      const key = JSON.stringify([edge.physicalNetId, port.nodeId, port.side, x, y]);
      if (!anchors.has(key)) anchors.set(key, new Set());
      anchors.get(key).add(id);
    }
  }
  let groupCount = 0, linkCount = 0;
  for (const ids of anchors.values()) if (ids.size > 1) {
    groupCount++;
    const ordered = [...ids].toSorted(), representative = ordered[0];
    for (const id of ordered.slice(1)) {
      adjacency.get(representative).push(id);
      adjacency.get(id).push(representative);
      linkCount++;
    }
  }
  return { groupCount, linkCount };
}
