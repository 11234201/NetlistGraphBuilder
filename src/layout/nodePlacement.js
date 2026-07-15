// Compatibility barrel. New layout code should import the owning policy module directly.
export {
  alignDrivenTargetsToDriverPins,
  alignSingleConnectionEndpoints,
  applyBranchAwareLanes
} from "./nodeAlignment.js";
export {
  applyFanoutHubLocality,
  applySingleFanoutInputLocality
} from "./nodeLocality.js";
export {
  computeLevelXs,
  resolveExternalSourceOverlaps,
  resolveLevelOverlaps,
  resolveOutputOverlaps
} from "./nodeSpacing.js";
export { compareNodes } from "./nodePlacementShared.js";
