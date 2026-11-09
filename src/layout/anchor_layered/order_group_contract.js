import {PhaseError} from './protocol.js';

// Fixed H08 ordering semantics; metadata and algorithms consume this one policy.
export const ORDER_GROUP_POLICY=Object.freeze({groupBandTolerance:2,extraCandidateLimit:1});

// Internal phase checks, not a browser dependency on Node's assertion module.
export function requireOrderGroup(condition, detail = 'invalid group state') {
  if (!condition) throw new PhaseError('p3', 'invalid-order-group', [], detail);
}

export function requireEqualOrderGroup(actual, expected, detail = 'invalid group state') {
  requireOrderGroup(actual === expected, detail);
}
