import { readSpacingInput, syncSpacingControls } from "./spacingControls.js";

export function createLayoutSpacingController({ elements, getSpacing, onCommit }) {
  if (typeof getSpacing !== "function" || typeof onCommit !== "function") {
    throw new Error("Layout spacing controller requires query and command ports");
  }
  function commit(key, rawValue) {
    const spacing = getSpacing();
    const value = readSpacingInput(rawValue, key, spacing[key]);
    onCommit(key, value);
    syncSpacingControls(elements, getSpacing());
    return value;
  }
  const bind = (element, eventName, key) => element.addEventListener(eventName, (event) => commit(key, event.target.value));
  bind(elements.wireSpacingInput, "input", "wireLanePitch");
  bind(elements.wireSpacingNumberInput, "change", "wireLanePitch");
  bind(elements.cellSpacingInput, "input", "cellSpacing");
  bind(elements.cellSpacingNumberInput, "change", "cellSpacing");
  return Object.freeze({
    commit,
    sync: () => syncSpacingControls(elements, getSpacing())
  });
}
