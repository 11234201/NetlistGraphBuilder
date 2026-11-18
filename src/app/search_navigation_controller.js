import { resolveSearchTargetAction, findSearchTargetNode } from "./searchLocatePolicy.js";
import { getReadableObjectScale } from "../ui/viewport.js";
import { runFocusedViewCommand } from "../application/focused_view_command.js";
import { cancelCanvasGestures } from "../ui/canvas_gesture_lifecycle.js";

// Legacy workbench adapter. State and elements are restricted ports supplied
// by the composition root; peer actions are explicit, late-bound services.
export function createSearchNavigationController({ state, elements, services, comparePathScope = () => null }) {
  function handleComparePath(result, add) {
    const scope = comparePathScope(result);
    if (!scope || result.kind === "module") return false;
    const target = result.target;
    if (!scope.graph.path.searchKeys.has(JSON.stringify([target.kind, target.name]))) {
      services.setStatus("Outside Show Path · Add as start or end to edit the query.");
      return true;
    }
    elements.searchResults.hidden = true;
    if (!add && resolveSearchTargetAction(target, scope.graph) === "locate") scope.select();
    else runFocusedViewCommand({
      command: { type: "focus.add", objectRef: scope.ref }, dispatch: scope.dispatch,
      readGraph: () => scope.graph, isReady: scope.ready, rebuild: scope.rebuild,
      resetViewport: () => {}, onRendered: scope.select, onRejected: () => services.setStatus("Focused root limit reached")
    });
    return true;
  }

  function outsidePath(result) {
    const path = state.graph?.moduleName === result?.moduleName && state.graph?.path;
    if (path && result?.target && result.target.kind !== "module") return !path.searchKeys.has(JSON.stringify([result.target.kind, result.target.name]));
    return Boolean(result?.outsidePath && state.currentModule?.name !== result?.moduleName);
  }

  function activateSearchResult(result) {
    if (handleComparePath(result, false)) return;
    if (outsidePath(result)) { services.setStatus("Outside Show Path · Add as start or end to edit the query."); return; }
    if (!result) {
      return;
    }
    if (state.currentModule?.name !== result.moduleName) {
      services.selectModule(result.moduleName, { onRendered: () => activateSearchResult(result) });
      return;
    }

    elements.searchResults.hidden = true;
    const target = result.target;
    if (target.kind === "module") {
      services.setSelectedNode(null);
      services.setStatus(`Search: module ${result.label}`);
      return;
    }
    if (target.kind === "net") {
      // Projection metadata contains only nets hidden inside this view.
      if (state.graph?.unroutedNets?.includes(target.name)) {
        services.setSelectedNet(target.name);
        services.setStatus(`Search: net ${result.label} is not routed; enable Route net in Selection to restore`);
        return;
      }
      const action = resolveSearchTargetAction(target, state.graph, state.fullGraph);
      const edge = state.graph?.edges.find((item) => item.net === target.name);
      if (action === "locate" && edge) {
        services.setSelectedNet(target.name, false);
        centerGraphPoint(getEdgeCenter(edge));
        services.setStatus(`Search: net ${result.label}`);
        return;
      }
      const fullEdge = state.fullGraph?.edges.find((item) => item.net === target.name);
      if (action === "focus" && fullEdge) {
        revealSearchTarget(result.objectRef || services.singleViewSession.objectRefForNet(target.name), () => {
          const positioned = state.graph?.edges.find((item) => item.net === target.name);
          services.setSelectedNet(target.name, false);
          if (positioned) centerGraphPoint(getEdgeCenter(positioned));
          services.setStatus(`Focused search net ${result.label}`);
        });
        return;
      }
      // A search hit that is not in the positioned graph must never become a
      // dangling selection.  The full graph is the source of truth for whether
      // the target can be promoted into a Focused root; otherwise leave the
      // current selection untouched and report that the target is unavailable.
      services.setStatus(fullEdge
        ? `Search: net ${result.label} could not be focused`
        : `Search: net ${result.label} is unavailable in the current graph`);
      return;
    }

    const fullNode = findSearchTargetNode(target, state.fullGraph);
    if ((target.kind === "cell" || (state.graph?.path && target.kind === "port")) && fullNode) {
      const action = state.graph?.path && target.kind === "port" && !findSearchTargetNode(target, state.graph) ? "focus"
        : resolveSearchTargetAction(target, state.graph, state.fullGraph);
      const positioned = action === "locate" ? findSearchTargetNode(target, state.graph) : null;
      if (action === "locate" && positioned) {
        services.setSelectedNode(positioned.id, false);
        centerGraphPoint({ x: positioned.x + positioned.width / 2, y: positioned.y + positioned.height / 2 }, positioned.width);
        services.setStatus(`Search: ${result.kind} ${result.label}`);
        return;
      }
      if (action === "focus") revealSearchTarget(result.objectRef || services.singleViewSession.objectRefForNode(fullNode), () => {
        const positioned = state.graph?.nodes.find((node) => node.id === fullNode.id);
        services.setSelectedNode(positioned?.id || null, false);
        if (positioned) centerGraphPoint({ x: positioned.x + positioned.width / 2, y: positioned.y + positioned.height / 2 }, positioned.width);
        services.setStatus(`Focused ${result.label}: fanin ${state.faninDepth}, fanout ${state.fanoutDepth}`);
      });
      if (action !== "focus") services.setStatus(`Search: ${result.label} is unavailable in the current graph`);
      return;
    }
    const node = findSearchTargetNode(target, state.graph);
    if (!node) {
      services.setStatus(`Search: ${result.kind} ${result.label} is unavailable in the current graph`);
      return;
    }
    services.setSelectedNode(node.id);
    if (node) {
      centerGraphPoint({
        x: node.x + node.width / 2,
        y: node.y + node.height / 2
      }, node.width);
    }
    services.setStatus(`Search: ${result.kind} ${result.label}`);
  }

  function revealSearchTarget(objectRef, onRendered) {
    return runFocusedViewCommand({
      command: { type: "selection.reveal", objectRef,
        visibleObjectKeys: services.singleViewSession.visibleObjectKeys() },
      dispatch: (command) => services.singleViewSession.dispatch(command),
      readGraph: () => state.graph,
      isReady: () => services.singleViewSession.isWorkspaceReady(),
      resetViewport: () => services.setSingleTransform({ x: 0, y: 0, scale: 1 }),
      rebuild: (options) => services.renderCurrentModuleGraph(options),
      onRejected: () => services.setStatus("Search target could not be added to Focused roots"),
      onRendered
    });
  }

  function addSearchResultToFocus(result) {
    if (handleComparePath(result, true)) return;
    if (outsidePath(result)) { services.setStatus("Outside Show Path · Add as start or end to edit the query."); return; }
    if (!result || !["cell", "net"].includes(result.target?.kind)) return;
    if (state.currentModule?.name !== result.moduleName) {
      services.selectModule(result.moduleName, { onRendered: () => addSearchResultToFocus(result) });
      return;
    }
    const fullNode = result.target.kind === "cell"
      ? findSearchTargetNode(result.target, state.fullGraph)
      : null;
    const fullEdge = result.target.kind === "net"
      ? state.fullGraph?.edges.find((edge) => edge.net === result.target.name)
      : null;
    if (!fullNode && !fullEdge) return;
    elements.searchResults.hidden = true;
    return runFocusedViewCommand({
      command: { type: "focus.add", objectRef: result.objectRef || (fullNode
        ? services.singleViewSession.objectRefForNode(fullNode)
        : services.singleViewSession.objectRefForNet(result.target.name)) },
      dispatch: (command) => services.singleViewSession.dispatch(command),
      readGraph: () => state.graph,
      isReady: () => services.singleViewSession.isWorkspaceReady(),
      resetViewport: () => services.setSingleTransform({ x: 0, y: 0, scale: 1 }),
      rebuild: (options) => services.renderCurrentModuleGraph(options),
      onRejected: () => services.setStatus("Focused root limit reached"),
      onUnchanged: () => {
        if (fullNode) services.setSelectedNode(fullNode.id);
        else services.setSelectedNet(result.target.name);
        services.setStatus(`${result.label} is already a Focused root`);
      },
      onRendered: (graph) => {
        const node = fullNode ? graph.nodes.find((item) => item.id === fullNode.id) : null;
        const edge = fullEdge ? graph.edges.find((item) => item.net === result.target.name) : null;
        if (node) {
          services.setSelectedNode(node.id, false);
          centerGraphPoint({ x: node.x + node.width / 2, y: node.y + node.height / 2 }, node.width);
        } else if (edge || graph.unroutedNets?.includes(result.target.name)) {
          services.setSelectedNet(result.target.name, false);
          if (edge) centerGraphPoint(getEdgeCenter(edge));
        }
        services.setStatus(`Added ${result.label} to ${state.focusedRootNodeIds.length} Focused roots`);
      }
    });
  }

  function centerGraphPoint(point, objectWidth = 100) {
    const svg = services.getSvg();
    if (!svg || !point) {
      return;
    }
    cancelCanvasGestures(svg);
    const viewBox = svg.viewBox.baseVal;
    const viewport = svg.getBoundingClientRect();
    const scale = getReadableObjectScale({
      viewBoxWidth: viewBox.width,
      viewportWidth: viewport.width,
      viewBoxHeight: viewBox.height,
      viewportHeight: viewport.height,
      objectWidth,
      currentScale: state.transform.scale
    });
    services.setSingleTransform({
      x: viewBox.width / 2 - point.x * scale,
      y: viewBox.height / 2 - point.y * scale,
      scale
    });
    services.applyTransform();
  }

  function getEdgeCenter(edge) {
    const points = edge?.points || [];
    const middle = points[Math.floor(points.length / 2)];
    return middle || points[0] || null;
  }

  return Object.freeze({ activateSearchResult, revealSearchTarget, addSearchResultToFocus, centerGraphPoint, getEdgeCenter });
}

export const searchNavigationPorts = Object.freeze({
  historyActions: {
    "activateSearchResult": "Locate search target",
    "addSearchResultToFocus": "Add search target to Focused"
  },
  state: [
    "currentModule", "faninDepth", "fanoutDepth", "focusedRootNodeIds", "fullGraph", "graph",
    "transform"
  ],
  elements: [
    "searchResults"
  ],
  services: [
    "applyTransform", "getSvg", "renderCurrentModuleGraph", "selectModule",
    "setSelectedNet", "setSelectedNode", "setSingleTransform", "setStatus", "singleViewSession"
  ]
});
