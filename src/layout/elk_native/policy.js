import { PhaseError, freezeRecord } from './protocol.js';

// Pinned ELK orthogonal routing semantics. One owning profile, shared by predicates/splitting/materialization.
export const ORTHOGONAL_ROUTING_PROFILE = Object.freeze({ tolerance: 1e-3,
  conflictThresholdFactor: 0.5, criticalThresholdFactor: 0.2,
  conflictPenalty: 1, crossingPenalty: 16, criticalWeight: 1 });

export function normalizePolicy(input = {}) {
  const defaults = { randomSeed: 1, nodeNodeSpacing: 20, nodeNodeBetweenLayers: 20,
    edgeEdgeSpacing: 10, edgeNodeSpacing: 10, edgeNodeBetweenLayers: 10, componentSpacing: 20, nodeSelfLoopSpacing: 10,
    aspectRatio: 1.6, edgeStraightening: true,
    favorStraightEdges: true, portConstraints: 'FIXED_POS', thoroughness: 7, balanceLayers: true };
  const result = {};
  for (const [name, fallback] of Object.entries(defaults)) {
    const value = input[name] ?? fallback;
    if (typeof fallback === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0
        || (['randomSeed', 'thoroughness'].includes(name) && !Number.isSafeInteger(value))
        || (name === 'thoroughness' && value < 1)) {
        throw new PhaseError('p0', 'invalid-policy', [], name);
      }
    } else if (typeof value !== typeof fallback) throw new PhaseError('p0', 'invalid-policy', [], name);
    result[name] = value;
  }
  if (!['FIXED_POS', 'FIXED_ORDER'].includes(result.portConstraints)) {
    throw new PhaseError('p0', 'unsupported-port-constraints');
  }
  return freezeRecord(result);
}
