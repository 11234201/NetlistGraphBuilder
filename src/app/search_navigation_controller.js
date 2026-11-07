import { resolveSearchTargetAction, findSearchTargetNode } from "./searchLocatePolicy.js";
import { getReadableObjectScale } from "../ui/viewport.js";

// Legacy workbench adapter. State and elements are restricted ports supplied
// by the composition root; peer actions are explicit, late-bound services.
export function createSearchNavigationController({ state, elements, services }) {
  function activateSearchResult(result) {
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
      const action = resolveSearchTargetAction(target, state.graph, state.fullGraph);
      const edge = state.graph?.edges.find((item) => item.net === target.name);
      if (action === "locate" && edge) {
        services.setSelectedNet(target.name, false);
        centerGraphPoint(getEdgeCenter(edge));
        services.recordViewHistory();
        services.setStatus(`Search: net ${result.label}`);
        return;
      }
      const fullEdge = state.fullGraph?.edges.find((item) => item.net === target.name);
      if (action === "focus" && fullEdge) {
        revealSearchTarget(result.objectRef || services.singleViewSession.objectRefForNet(target.name), () => {
          const positioned = state.graph?.edges.find((item) => item.net === target.name);
          services.setSelectedNet(target.name, false);
          if (positioned) centerGraphPoint(getEdgeCenter(positioned));
          services.recordViewHistory();
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
    if (target.kind === "cell" && fullNode) {
      const action = resolveSearchTargetAction(target, state.graph, state.fullGraph);
      const positioned = action === "locate" ? findSearchTargetNode(target, state.graph) : null;
      if (action === "locate" && positioned) {
        services.singleViewSession.dispatch({
          type: "selection.set",
          objectRef: result.objectRef || services.singleViewSession.objectRefForNode(fullNode)
        });
        services.setSelectedNode(positioned.id, false);
        centerGraphPoint({ x: positioned.x + positioned.width / 2, y: positioned.y + positioned.height / 2 }, positioned.width);
        services.recordViewHistory();
        services.setStatus(`Search: ${result.kind} ${result.label}`);
        return;
      }
      if (action === "focus") revealSearchTarget(result.objectRef || services.singleViewSession.objectRefForNode(fullNode), () => {
        const positioned = state.graph?.nodes.find((node) => node.id === fullNode.id);
        services.setSelectedNode(positioned?.id || null, false);
        if (positioned) centerGraphPoint({ x: positioned.x + positioned.width / 2, y: positioned.y + positioned.height / 2 }, positioned.width);
        services.recordViewHistory();
        services.setStatus(`Focused ${result.label}: fanin ${state.faninDepth}, fanout ${state.fanoutDepth}`);
      });
      if (action !== "focus") services.setStatus(`Search: ${result.label} is unavailable in the current graph`);
      return;
    }
    const node = findSearchTargetNode(target);
    services.setSelectedNode(node?.id || null);
    if (node) {
      centerGraphPoint({
        x: node.x + node.width / 2,
        y: node.y + node.height / 2
      }, node.width);
    }
    services.setStatus(`Search: ${result.kind} ${result.label}`);
  }

  function revealSearchTarget(objectRef, onRendered) {
    const reveal = services.singleViewSession.dispatch({
      type: "selection.reveal",
      objectRef,
      visibleObjectKeys: services.singleViewSession.visibleObjectKeys()
    });
    if (reveal.rejected) {
      services.setStatus("Search target could not be added to Focused roots");
      return;
    }
    if (!reveal.effects.layout) {
      onRendered?.(state.graph);
      return;
    }
    services.setSingleTransform({ x: 0, y: 0, scale: 1 });
    services.renderCurrentModuleGraph({ onRendered });
  }

  function addSearchResultToFocus(result) {
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
    const action = services.singleViewSession.dispatch({
      type: "focus.add",
      objectRef: result.objectRef || (fullNode
        ? services.singleViewSession.objectRefForNode(fullNode)
        : services.singleViewSession.objectRefForNet(result.target.name))
    });
    if (action.rejected) { services.setStatus("Focused root limit reached"); return; }
    if (!action.effects.layout) {
      if (fullNode) services.setSelectedNode(fullNode.id);
      else services.setSelectedNet(result.target.name);
      services.setStatus(`${result.label} is already a Focused root`);
      return;
    }
    services.setSingleTransform({ x: 0, y: 0, scale: 1 });
    services.renderCurrentModuleGraph({
      onRendered: (graph) => {
        const node = fullNode ? graph.nodes.find((item) => item.id === fullNode.id) : null;
        const edge = fullEdge ? graph.edges.find((item) => item.net === result.target.name) : null;
        if (node) {
          services.setSelectedNode(node.id, false);
          centerGraphPoint({ x: node.x + node.width / 2, y: node.y + node.height / 2 }, node.width);
        } else if (edge) {
          services.setSelectedNet(result.target.name, false);
          centerGraphPoint(getEdgeCenter(edge));
        }
        services.recordViewHistory();
        services.setStatus(`Added ${result.label} to ${state.focusedRootNodeIds.length} Focused roots`);
      }
    });
  }

  function centerGraphPoint(point, objectWidth = 100) {
    const svg = services.getSvg();
    if (!svg || !point) {
      return;
    }
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
  state: [
    "currentModule", "faninDepth", "fanoutDepth", "focusedRootNodeIds", "fullGraph", "graph",
    "transform"
  ],
  elements: [
    "searchResults"
  ],
  services: [
    "applyTransform", "getSvg", "recordViewHistory", "renderCurrentModuleGraph", "selectModule",
    "setSelectedNet", "setSelectedNode", "setSingleTransform", "setStatus", "singleViewSession"
  ]
});
