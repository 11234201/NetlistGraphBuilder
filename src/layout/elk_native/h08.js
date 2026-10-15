import {layoutGraph as layoutCore} from './index.js';
export {CONTRACT_VERSION,PACKAGE_VERSION,PhaseError} from './protocol.js';
export {H08_PROFILE_VERSION} from './h08_profile.js';

// Fixed, clone-importable offline entry. Callers supply measured W/E ports and
// optional public orderGroups; they cannot silently disable profile mechanisms.
export function layoutGraph(input, options = {}) {
  return layoutCore(input,{...options,profile:'h08'});
}
