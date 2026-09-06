import { LAYOUT_SPACING_LIMITS, snapLayoutSpacingValue } from "../layout/layoutPolicy.js";

export function syncSpacingControls(elements, spacing) {
  for (const [prefix, key] of [["wire", "wireLanePitch"], ["cell", "cellSpacing"]]) {
    const [minimum, maximum] = LAYOUT_SPACING_LIMITS[key];
    const value = String(Math.max(minimum, Math.min(maximum, spacing[key])));
    elements[`${prefix}SpacingInput`].value = value;
    elements[`${prefix}SpacingNumberInput`].value = value;
    elements[`${prefix}SpacingValue`].value = value;
  }
}

export function readSpacingInput(value, key, previous) {
  if (typeof value === "string" && value.trim() === "") return previous;
  return snapLayoutSpacingValue(value, LAYOUT_SPACING_LIMITS[key], undefined, previous);
}
