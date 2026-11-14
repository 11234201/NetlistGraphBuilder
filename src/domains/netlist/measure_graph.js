import { measureLegacyLayoutGraph } from "../../layout/legacy_measurement.js";

// The schematic projection retains its established symbol dimensions. Resolve
// all symbol/terminal semantics here before entering the neutral layout API.
export function measureNetlistGraph(graph, options = {}) {
  return measureLegacyLayoutGraph(graph, { ...options, respectExistingSize: false });
}
