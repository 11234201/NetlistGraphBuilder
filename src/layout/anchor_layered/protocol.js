export const CONTRACT_VERSION = '1.1.0';
export const PACKAGE_VERSION = '0.3.0';

export class PhaseError extends Error {
  constructor(phase, invariant, entityIds = [], detail = '') {
    super(`${phase}: ${invariant}${detail ? ` (${detail})` : ''}`);
    this.name = 'ElkNativePhaseError';
    this.diagnostic = Object.freeze({ phase, invariant,
      entityIds: Object.freeze([...entityIds].sort(compareIds)), detail });
  }
}

export function compareIds(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function freezeRecord(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeRecord);
    Object.freeze(value);
  }
  return value;
}

export function checkCancelled(signal) {
  if (signal?.aborted) {
    const error = new Error('Layout cancelled');
    error.name = 'AbortError';
    throw error;
  }
}
