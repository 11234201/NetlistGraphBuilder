

// Legacy workbench adapter. State and elements are restricted ports supplied
// by the composition root; peer actions are explicit, late-bound services.
export function createHelpersController({ state, elements, services }) {
  function isEditableNodeProperty(property) {
    return ["label", "title", "subtitle", "gateKind", "inferenceSource"].includes(property);
  }

  function getNodeInstance(node) {
    return node.ref?.instance || (node.id.startsWith("cell:") ? node.id.slice("cell:".length) : null);
  }

  function countGraphOverrides() {
    return (
      Object.keys(state.graphOverrides.nodeProperties).length +
      Object.keys(state.graphOverrides.cellPinDirections).length
    );
  }

  function hasCompareLayoutOverrides() {
    return ["left", "right"].some((side) =>
      state.compare.nodePositions[side].size > 0 ||
      state.compare.nodeSizes[side].size > 0 ||
      Object.keys(state.compare.graphOverrides[side].nodeProperties).length > 0 ||
      Object.keys(state.compare.graphOverrides[side].cellPinDirections).length > 0
    );
  }

  function cssEscape(value) {
    if (globalThis.CSS?.escape) {
      return globalThis.CSS.escape(value);
    }
    return String(value).replaceAll('"', '\\"');
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function round(value) {
    return Math.round(value * 1000) / 1000;
  }

  return Object.freeze({ isEditableNodeProperty, getNodeInstance, countGraphOverrides, hasCompareLayoutOverrides, cssEscape, clamp, round });
}

export const helpersPorts = Object.freeze({
  state: [
    "compare", "graphOverrides"
  ],
  elements: [

  ],
  services: [

  ]
});
