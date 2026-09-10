// Compatibility barrel. New code imports the Netlist domain projection directly.
export {
  applyWorkspaceGraphTransforms,
  buildWorkspaceGraph,
  resolveCellConfigRefreshView,
  selectWorkspaceGraphView,
  shouldUseSearchFirst
} from "../domains/netlist/netlist_graph_projection.js";
