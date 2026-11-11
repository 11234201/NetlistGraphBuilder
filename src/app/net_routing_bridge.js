import { resolveUnroutedNets, setNetRoutingEnabled } from "../domains/netlist/net_routing.js";

// Narrow queries/commands for the inspector; all writes use existing override
// commands so module workspaces and View History retain the same ownership.
export function createNetRoutingBridge({ readContext, updateOverrides, rebuild }) {
  return Object.freeze({
    isEnabled(netName, side = null) {
      const { fullGraph, graphOverrides } = readContext(side);
      return !resolveUnroutedNets(fullGraph, graphOverrides?.unroutedNets).has(netName);
    },
    setEnabled(netName, enabled, side = null) {
      const { fullGraph } = readContext(side);
      if (!netName || !fullGraph) return;
      updateOverrides(side, (overrides) => {
        overrides.graphOverrides = setNetRoutingEnabled(overrides.graphOverrides, fullGraph, netName, enabled);
      });
      rebuild(side);
    }
  });
}
