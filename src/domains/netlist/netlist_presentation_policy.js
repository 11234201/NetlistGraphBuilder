export const GATE_SYMBOL_MODES = Object.freeze(["rectangle", "conventional"]);
export const DEFAULT_NETLIST_PRESENTATION_POLICY = Object.freeze({
  gateSymbolMode: "rectangle"
});

export function normalizeNetlistPresentationPolicy(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.freeze({
    gateSymbolMode: GATE_SYMBOL_MODES.includes(source.gateSymbolMode)
      ? source.gateSymbolMode
      : DEFAULT_NETLIST_PRESENTATION_POLICY.gateSymbolMode
  });
}
