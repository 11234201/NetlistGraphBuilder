import { normalizeFocusedRootNodeIds as normalizeFocusedSelectionRoots } from "./focusedSelection.js";

export function resolveFocusedRootContext(state, requestedSide) {
  if (state.compare.active) {
    const side = requestedSide || state.compare.selectedSide || "left";
    return {
      compare: true,
      side,
      fullGraph: state.compare.fullGraphs?.[side] || state.compare.graphs?.[side],
      graph: state.compare.graphs?.[side],
      roots: normalizeFocusedSelectionRoots(state.compare.focusedRootNodeIds?.[side]),
      activeRootNodeId: state.compare.activeFocusedRootNodeId?.[side] || null
    };
  }
  return {
    compare: false,
    side: null,
    fullGraph: state.fullGraph,
    graph: state.graph,
    roots: normalizeFocusedSelectionRoots(state.focusedRootNodeIds),
    activeRootNodeId: state.activeFocusedRootNodeId
  };
}
