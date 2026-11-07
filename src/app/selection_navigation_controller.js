import { getCompareNodeName } from "./compareWorkspace.js";

// Legacy workbench adapter. State and elements are restricted ports supplied
// by the composition root; peer actions are explicit, late-bound services.
export function createSelectionNavigationController({ state, elements, services }) {
  function handleSingleNodeSelection(nodeId) {
    const node = state.graph?.nodes.find((item) => item.id === nodeId)
      || state.fullGraph?.nodes.find((item) => item.id === nodeId)
      || null;
    services.singleViewSession.dispatch(node ? {
      type: "selection.set",
      objectRef: services.singleViewSession.objectRefForNode(node)
    } : { type: "selection.clear" });
    services.renderSelection(node);
    services.updateViewControls();
  }

  function handleSingleNetSelection(netName) {
    services.singleViewSession.dispatch(netName ? {
      type: "selection.set",
      objectRef: services.singleViewSession.objectRefForNet(netName)
    } : { type: "selection.clear" });
    services.renderNetSelection(netName);
    services.updateViewControls();
  }

  function setSelectedNode(nodeId, shouldRecord = true) {
    state.selectionFocusRequestId += 1;
    services.schematicSelectionController.selectNode(nodeId);
    if (shouldRecord) services.recordViewHistory();
  }

  function setSelectedNet(netName, shouldRecord = true) {
    state.selectionFocusRequestId += 1;
    services.schematicSelectionController.selectNet(netName);
    if (shouldRecord) services.recordViewHistory();
  }

  function clearSchematicSelection() {
    services.schematicSelectionController.clearDomSelection();
  }

  function handleSelectionNavigationClick(event) {
    const button = event.target.closest?.("[data-selection-target-kind]");
    if (!button) return;

    const kind = button.dataset.selectionTargetKind;
    const target = kind === "net"
      ? { kind, name: button.dataset.selectionTargetName }
      : { kind, id: button.dataset.selectionTargetId };
    if (button.dataset.selectionTargetModule) {
      target.moduleName = button.dataset.selectionTargetModule;
      target.rootModuleName = button.dataset.selectionTargetRootModule || target.moduleName;
      try { target.occurrencePath = JSON.parse(button.dataset.selectionTargetOccurrence || "[]"); }
      catch { target.occurrencePath = []; }
    }
    if ((kind === "net" && !target.name) || (kind === "node" && !target.id)) return;

    event.preventDefault();
    if (state.compare.active) navigateCompareSelectionTarget(target);
    else navigateSingleSelectionTarget(target);
  }

  function navigateSingleSelectionTarget(target) {
    if (selectionTargetChangesHierarchyContext(target)) {
      return services.runViewHistoryTransaction({ label: "Open hierarchy connection" }, () => {
        if (target.kind === "net") {
          services.selectModule(target.moduleName, {
            rootModuleName: target.rootModuleName,
            occurrencePath: target.occurrencePath,
            deferRender: true
          });
          replaceFocusWithSelectionTarget(target);
          return;
        }
        services.selectModule(target.moduleName, {
          rootModuleName: target.rootModuleName,
          occurrencePath: target.occurrencePath,
          onRendered: () => replaceFocusWithSelectionTarget(target)
        });
      });
    }
    if (focusSingleSelectionTarget(target)) return;
    if (!selectionTargetExists(state.fullGraph, target)) {
      services.setStatus("Connected object is no longer available in this module");
      return;
    }

    if (target.kind === "net") {
      setSelectedNet(target.name);
      services.setStatus("Connected net is outside the current Focused view");
      return;
    }

    const fullNode = state.fullGraph?.nodes.find((node) => node.id === target.id);
    if (state.viewMode !== "focused" || fullNode?.kind !== "cell") {
      services.setStatus("Connected node is outside the current view; use Whole to reveal it");
      return;
    }

    const reveal = services.singleViewSession.dispatch({
      type: "selection.reveal",
      objectRef: services.singleViewSession.objectRefForNode(fullNode),
      visibleObjectKeys: services.singleViewSession.visibleObjectKeys(),
      replaceActiveWhenFull: true
    });
    if (reveal.rejected) {
      services.setStatus("Connected cell could not be added to the current Focused roots");
      return;
    }
    services.updateViewControls();
    services.setStatus("Opening connected cell in Focused view…");
    services.renderCurrentModuleGraph({
      onRendered: (graph) => {
        const node = graph.nodes.find((item) => item.id === fullNode.id);
        setSelectedNode(node?.id || null);
        if (!node) {
          services.setStatus("Connected cell is inside a collapsed group; expand the group to reveal it");
          return;
        }
        services.centerGraphPoint({
          x: node.x + node.width / 2,
          y: node.y + node.height / 2
        }, node.width);
        services.setStatus(`Focused connected cell: ${node.label}`);
      }
    });
  }

  function selectionTargetChangesHierarchyContext(target) {
    if (!target.moduleName) return false;
    const currentRootModuleName = state.occurrenceContext?.rootModuleName || state.currentModule?.name || null;
    const currentOccurrencePath = state.occurrenceContext?.occurrencePath || [];
    const targetOccurrencePath = Array.isArray(target.occurrencePath) ? target.occurrencePath : [];
    return target.moduleName !== state.currentModule?.name ||
      (target.rootModuleName || target.moduleName) !== currentRootModuleName ||
      !services.sameOccurrencePath(currentOccurrencePath, targetOccurrencePath);
  }

  function replaceFocusWithSelectionTarget(target) {
    const node = target.kind === "node"
      ? state.fullGraph?.nodes.find((item) => item.id === target.id)
      : null;
    const objectRef = target.kind === "net"
      ? services.singleViewSession.objectRefForNet(target.name)
      : node ? services.singleViewSession.objectRefForNode(node) : null;
    if (!objectRef) {
      services.setStatus("Connected hierarchy object is unavailable");
      return;
    }
    services.singleViewSession.dispatch({ type: "focus.replace", objectRefs: [objectRef], activeObjectRef: objectRef });
    services.setSingleTransform({ x: 0, y: 0, scale: 1 });
    services.renderCurrentModuleGraph({
      onRendered: (graph) => {
        if (target.kind === "net") {
          const edge = graph.edges.find((item) => item.net === target.name);
          setSelectedNet(edge ? target.name : null, false);
          if (edge) services.centerGraphPoint(services.getEdgeCenter(edge));
        } else {
          const positioned = graph.nodes.find((item) => item.id === target.id);
          setSelectedNode(positioned?.id || null, false);
          if (positioned) services.centerGraphPoint({ x: positioned.x + positioned.width / 2, y: positioned.y + positioned.height / 2 }, positioned.width);
        }
        services.recordViewHistory();
        services.setStatus(`Focused connected object in ${state.currentModule.displayName}`);
      }
    });
  }

  function focusSingleSelectionTarget(target) {
    if (target.kind === "net") {
      const edge = state.graph?.edges.find((item) => item.net === target.name);
      if (!edge) return false;
      setSelectedNet(target.name);
      services.centerGraphPoint(services.getEdgeCenter(edge));
      services.setStatus(`Connected net: ${edge.label || target.name}`);
      return true;
    }

    const node = state.graph?.nodes.find((item) => item.id === target.id);
    if (!node) return false;
    setSelectedNode(node.id);
    services.centerGraphPoint({
      x: node.x + node.width / 2,
      y: node.y + node.height / 2
    }, node.width);
    services.setStatus(`Connected ${node.kind}: ${node.label}`);
    return true;
  }

  function selectionTargetExists(graph, target) {
    if (target.kind === "net") return graph?.edges.some((edge) => edge.net === target.name) || false;
    return graph?.nodes.some((node) => node.id === target.id) || false;
  }

  function navigateCompareSelectionTarget(target) {
    const side = state.compare.selectedSide || "left";
    const graph = state.compare.graphs[side];
    if (target.kind === "net") {
      if (!graph?.edges.some((edge) => edge.net === target.name)) {
        services.setStatus("Connected net is outside the current compare cone");
        return;
      }
      services.selectCompareObject("net", target.name, true, side);
      services.setStatus(`Connected net: ${target.name}`);
      return;
    }

    const node = graph?.nodes.find((item) => item.id === target.id);
    if (!node) {
      services.setStatus("Connected node is outside the current compare cone");
      return;
    }
    const kind = node.kind === "cell" ? "cell" : "port";
    services.selectCompareObject(kind, getCompareNodeName(node), true, side);
    services.setStatus(`Connected ${node.kind}: ${node.label}`);
  }

  return Object.freeze({ handleSingleNodeSelection, handleSingleNetSelection, setSelectedNode, setSelectedNet, clearSchematicSelection, handleSelectionNavigationClick, navigateSingleSelectionTarget, selectionTargetChangesHierarchyContext, replaceFocusWithSelectionTarget, focusSingleSelectionTarget, selectionTargetExists, navigateCompareSelectionTarget });
}

export const selectionNavigationPorts = Object.freeze({
  state: [
    "compare", "currentModule", "fullGraph", "graph", "occurrenceContext", "selectionFocusRequestId",
    "viewMode"
  ],
  elements: [

  ],
  services: [
    "renderSelection", "renderNetSelection", "centerGraphPoint", "getEdgeCenter", "recordViewHistory", "renderCurrentModuleGraph",
    "runViewHistoryTransaction", "sameOccurrencePath", "schematicSelectionController",
    "selectCompareObject", "selectModule", "setSingleTransform", "setStatus", "singleViewSession",
    "updateViewControls"
  ]
});
