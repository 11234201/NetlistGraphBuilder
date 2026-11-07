import { toggleFocusedRootNodeId } from "./focusedSelection.js";
import { startCanvasPan } from "../ui/canvas_pan_controller.js";
import { findReferencedModule } from "./moduleNavigation.js";
import { findModuleOccurrences, buildModuleHierarchy } from "../domains/netlist/module_hierarchy.js";
import { startCanvasNodeDrag } from "../ui/canvas_node_drag_controller.js";
import { applyWorkspaceOverrides } from "./layoutWorkspace.js";
import { createNetlistScene } from "../domains/netlist/netlist_scene.js";

// Legacy workbench adapter. State and elements are restricted ports supplied
// by the composition root; peer actions are explicit, late-bound services.
export function createCanvasController({ state, elements, services }) {
  function handleWheel(event) {
    if (state.compare.active) {
      services.handleCompareWheel(event);
      return;
    }
    const svg = services.getSvg();
    if (!svg) {
      return;
    }
    event.preventDefault();
    services.queueWheelGesture({
      mode: "single",
      clientX: event.clientX,
      clientY: event.clientY,
      deltaY: event.deltaY
    });
  }

  function handlePointerDown(event) {
    if (state.compare.active) {
      services.handleComparePointerDown(event);
      return;
    }
    const svg = services.getSvg();
    if (!svg || event.button !== 0) {
      return;
    }

    const nodeElement = event.target.closest("[data-node-id]");
    if (state.calibrationMode && nodeElement) {
      startNodeDrag(event, nodeElement.dataset.nodeId);
      return;
    }
    if (nodeElement) {
      const clickedNode = state.graph?.nodes.find((node) => node.id === nodeElement.dataset.nodeId);
      if (event.shiftKey && clickedNode?.kind === "cell") {
        const nextRoots = toggleFocusedRootNodeId(state.focusedRootNodeIds, clickedNode.id);
        services.setSelectedNode(clickedNode.id);
        services.replaceSingleFocusedRoots(nextRoots,
          nextRoots.includes(clickedNode.id) ? clickedNode.id : null);
        services.setSingleTransform({ x: 0, y: 0, scale: 1 });
        services.renderCurrentModuleGraph();
        services.setStatus(nextRoots.includes(clickedNode.id)
          ? `Added Focused root: ${clickedNode.label}`
          : `Removed Focused root: ${clickedNode.label}`);
        return;
      }
      services.setSelectedNode(nodeElement.dataset.nodeId);
      return;
    }

    const edgeElement = event.target.closest("[data-edge-id]");
    if (edgeElement) {
      services.setSelectedNet(edgeElement.dataset.net);
      return;
    }

    startCanvasPan({
      event,
      target: elements.canvas,
      svg,
      transform: state.transform,
      commit(transform) {
        services.setSingleTransform(transform);
        services.applyTransform(false);
      },
      onEnd({ didPan, cancelled }) {
        if (didPan && !cancelled) services.persistSession({ label: "Viewport gesture" });
        if (!didPan && !cancelled) services.setSelectedNode(null);
      }
    });
  }

  function handleCanvasDoubleClick(event) {
    const nodeElement = event.target.closest?.("[data-node-id]");
    if (!nodeElement) return;

    let node = null;
    let sourceModule = state.currentModule;
    if (state.compare.active) {
      const side = event.target.closest?.("[data-compare-side]")?.dataset.compareSide;
      if (!side) return;
      node = state.compare.graphs[side]?.nodes.find((item) => item.id === nodeElement.dataset.nodeId);
      sourceModule = services.getCompareModule(side);
    } else {
      node = state.graph?.nodes.find((item) => item.id === nodeElement.dataset.nodeId);
    }
    if (!node?.referencedModuleName) return;

    const referencedModule = findReferencedModule(state.design, node);
    if (!referencedModule) {
      services.setStatus(`Module definition not found: ${node.referencedModuleName}`);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const occurrenceNavigation = resolveChildOccurrenceNavigation(sourceModule, node, state.compare.active);
    if (state.compare.active) services.exitCompareView();
    const readyMessage = `Opened submodule ${referencedModule.displayName} from ${sourceModule?.displayName || "module"}.${node.label}`;
    services.selectModule(referencedModule.name, { readyMessage, ...occurrenceNavigation });
    services.setStatus(readyMessage);
  }

  function resolveChildOccurrenceNavigation(sourceModule, node, fromCompare) {
    const instance = node?.ref?.instance || node?.ref?.localId || node?.id?.replace(/^cell:/, "");
    if (!sourceModule || !instance) return {};
    if (!fromCompare && state.currentModule?.name === sourceModule.name && state.occurrenceContext) {
      return {
        rootModuleName: state.occurrenceContext.rootModuleName || sourceModule.name,
        occurrencePath: [...(state.occurrenceContext.occurrencePath || []), instance]
      };
    }
    const occurrences = findModuleOccurrences(buildModuleHierarchy(state.design), sourceModule.name);
    if (occurrences.length !== 1) return {};
    return {
      rootModuleName: occurrences[0].rootModuleName,
      occurrencePath: [...occurrences[0].occurrencePath, instance]
    };
  }

  function startNodeDrag(event, nodeId) {
    const node = state.graph?.nodes.find((item) => item.id === nodeId);
    if (!node) {
      return;
    }

    services.setSelectedNode(nodeId);
    let draggedPosition = state.nodePositions.get(nodeId);
    startCanvasNodeDrag({
      event,
      target: elements.canvas,
      mount: elements.mount,
      graph: state.graph,
      node,
      getPreviousPosition: () => draggedPosition,
      updatePosition: (position) => { draggedPosition = position; },
      onPreview({ position, snap }) {
        if (snap) {
          services.setStatus(`${node.label}: snapped ${snap.net} to y=${snap.targetY}`);
        } else {
          services.setStatus(`${node.label}: x=${position.x}, y=${position.y}`);
        }
      },
      onCommit({ preview }) {
        services.updateSingleOverrides((overrides) => overrides.nodePositions.set(nodeId, draggedPosition));
        services.setStatus(`Rerouting ${node.label}…`);
        services.runAfterNextPaint(() => commitNodeDrag(nodeId, preview));
      }
    });
  }

  function commitNodeDrag(nodeId, preview) {
    if (!state.autoGraph) {
      preview.clear();
      services.renderCurrentModuleGraph();
      return;
    }
    state.graph = applyWorkspaceOverrides(state.autoGraph, {
      nodePositions: state.nodePositions,
      nodeSizes: state.nodeSizes,
      layoutPolicy: state.layoutPolicy
    });
    state.scene = createNetlistScene(state.graph, { presentationPolicy: state.presentationPolicy });
    preview.clear();
    services.renderGraphMount(elements.mount, state.graph, { scene: state.scene }).then((result) => {
      if (result?.cancelled) return;
      services.setSelectedNode(nodeId);
      services.applyTransform();
      services.updateCalibrationControls();
      services.setStatus(`Layout overrides: ${state.nodePositions.size} moved node(s)`);
    });
  }

  function fitToView() {
    if (state.compare.active) {
      services.setCompareTransform("left", { x: 0, y: 0, scale: 1 }, false);
      services.setCompareTransform("right", { x: 0, y: 0, scale: 1 }, false);
      services.applyCompareTransforms();
      services.setStatus("Fit both compare views");
      services.recordViewHistory();
      return;
    }
    services.setSingleTransform({ x: 0, y: 0, scale: 1 });
    services.applyTransform();
    services.recordViewHistory();
  }

  return Object.freeze({ handleWheel, handlePointerDown, handleCanvasDoubleClick, resolveChildOccurrenceNavigation, startNodeDrag, commitNodeDrag, fitToView });
}

export const canvasPorts = Object.freeze({
  state: [
    "autoGraph", "calibrationMode", "compare", "currentModule", "design", "focusedRootNodeIds", "graph",
    "layoutPolicy", "nodePositions", "nodeSizes", "occurrenceContext", "presentationPolicy", "scene",
    "transform"
  ],
  elements: [
    "canvas", "mount"
  ],
  services: [
    "applyCompareTransforms", "applyTransform", "exitCompareView", "getCompareModule", "getSvg",
    "handleComparePointerDown", "handleCompareWheel", "persistSession", "queueWheelGesture",
    "recordViewHistory", "renderCurrentModuleGraph", "renderGraphMount", "replaceSingleFocusedRoots",
    "runAfterNextPaint", "selectModule", "setCompareTransform", "setSelectedNet", "setSelectedNode",
    "setSingleTransform", "setStatus", "updateCalibrationControls", "updateSingleOverrides"
  ]
});
