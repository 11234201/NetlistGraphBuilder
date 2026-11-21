import { createNavigationCommands } from "./remote_navigation_commands.js";
import { buildModuleHierarchy } from "../domains/netlist/module_hierarchy.js";
import { compareSelectionId } from "../domains/netlist/compare_objects.js";

// The application state remains owned by the existing workspace controllers.
// This adapter projects one side for the duration of a single command query.
export function createNavigationPort({ state, getElements, actions, netRouting, renderCompletion,
  domainWorkbench, search, clearSearch, readSelection }) {
  function read(side) {
    const compare = state.compare.active ? state.compare : null;
    const selectedSide = compare?.activeSide || compare?.selectedSide;
    side = compare ? side || selectedSide || "left" : null;
    const full = side ? compare.fullGraphs[side] : state.fullGraph;
    const graph = side ? compare.graphs[side] : state.graph;
    const el = getElements();
    return {
      compare:Boolean(compare), side, selectedSide, graph, full:full || graph,
      selected:side ? compareSelectionId(full || graph, readSelection(side)) :
        state.selectedNodeId || (state.selectedNet ? "net:" + state.selectedNet : null),
      moduleName:side ? compare[side + "ModuleName"] : state.currentModule?.name,
      documentId:state.document?.documentId, sourceRevision:state.document?.sourceRevision,
      occurrence:side ? null : state.occurrenceContext,
      mode:graph?.view?.mode || state.viewMode,
      roots:side ? compare.focusedRootNodeIds[side] : state.focusedRootNodeIds,
      activeRoot:side ? compare.activeFocusedRootNodeId[side] : state.activeFocusedRootNodeId,
      fanin:state.faninDepth, fanout:state.fanoutDepth,
      transform:side ? compare.transforms[side] : state.transform,
      mount:side ? el[side + "Mount"] : el.mount,
      overrides:side ? compare.graphOverrides[side] : state.graphOverrides,
      positions:side ? compare.nodePositions[side] : state.nodePositions,
      sizes:side ? compare.nodeSizes[side] : state.nodeSizes,
      adjust:state.calibrationMode, aliases:state.showAliases, hubs:state.useFanoutHubs,
      symbols:state.presentationPolicy.gateSymbolMode, provider:state.layoutProviderId, spacing:state.layoutPolicy.spacing,
      historyIndex:state.viewHistory.index, historyCount:state.viewHistory.entries.length
    };
  }
  return createNavigationCommands({ read, actions, elements:getElements(), netRouting, renderCompletion,
    hierarchy:() => buildModuleHierarchy(state.design), domainWorkbench, search, clearSearch });
}
