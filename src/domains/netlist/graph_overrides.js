import { cloneNetRoutingOverrides } from "./net_routing.js";

// A view's Netlist overrides have one snapshot boundary across commands,
// workspace switching, history and session bridges. Geometry Maps remain owned
// by the caller; this function copies the domain-specific override records.
export function cloneGraphOverrides(value = {}) {
  return {
    ...cloneNetRoutingOverrides(value),
    nodeProperties: cloneRecord(value?.nodeProperties),
    cellPinDirections: cloneRecord(value?.cellPinDirections)
  };
}

function cloneRecord(value = {}) {
  return Object.fromEntries(Object.entries(value || {}).map(([id, item]) => [
    id,
    Array.isArray(item) ? item.map((entry) => ({ ...entry })) : { ...item }
  ]));
}
