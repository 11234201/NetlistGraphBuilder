import {layoutGraph as layoutCore} from './index.js';
export {CONTRACT_VERSION,PACKAGE_VERSION,PhaseError} from './protocol.js';
export {ANCHOR_PROFILE_VERSION, H08_PROFILE_VERSION} from './anchor_profile.js';

// Backward-compatibility offline entry for H08 callers.
// Callers supply measured W/E ports and optional public orderGroups; they cannot silently disable profile mechanisms.
export function layoutGraph(input, options = {}) {
  return layoutCore(input, {...options, profile: 'h08'});
}
