import { getCompareNodeName } from "./compareWorkspace.js";
import { startCanvasPan } from "../ui/canvas_pan_controller.js";
import {
  normalizeFocusedRootNodeIds as normalizeFocusedSelectionRoots,
  toggleFocusedRootNodeId
} from "./focusedSelection.js";
import { startCanvasNodeDrag } from "../ui/canvas_node_drag_controller.js";
import { getSteppedZoomedTransform, formatViewportTransform, clientPointToViewBox } from "../ui/viewport.js";
import { applyWorkspaceOverrides } from "./layoutWorkspace.js";
import { createNetlistScene } from "../domains/netlist/netlist_scene.js";
import { getLayoutProvider } from "../layout/layoutProvider.js";

// Legacy workbench adapter. State and elements are restricted ports supplied
// by the composition root; peer actions are explicit, late-bound services.
export function createCompareCanvasController({ state, elements, services }) {
  function handleCompareWheel(event) {
    const sideElement = event.target.closest("[data-compare-side]");
    const side = sideElement?.dataset.compareSide;
    const svg = sideElement?.querySelector("svg");
    if (!side || !svg) return;
    event.preventDefault();
    queueWheelGesture({
      mode: "compare",
      side,
      clientX: event.clientX,
      clientY: event.clientY,
      deltaY: event.deltaY
    });
  }

  function handleComparePointerDown(event) {
    const sideElement = event.target.closest("[data-compare-side]");
    const side = sideElement?.dataset.compareSide;
    const svg = sideElement?.querySelector("svg");
    if (!side || !svg || event.button !== 0) return;
    const nodeElement = event.target.closest("[data-node-id]");
    if (nodeElement) {
      const id = nodeElement.dataset.nodeId;
      const graphNode = state.compare.graphs[side]?.nodes.find((node) => node.id === id);
      if (state.calibrationMode && graphNode) {
        startCompareNodeDrag(event, side, graphNode);
        return;
      }
      if (event.shiftKey && graphNode?.kind === "cell") {
        services.selectCompareObject("cell", getCompareNodeName(graphNode), false, side);
        toggleCompareFocusedRoot(side, graphNode.id);
        return;
      }
      services.selectCompareObject(graphNode?.kind === "cell" ? "cell" : "port", getCompareNodeName(graphNode), true, side);
      return;
    }
    const edgeElement = event.target.closest("[data-edge-id]");
    if (edgeElement) {
      services.selectCompareObject("net", edgeElement.dataset.net, true, side);
      return;
    }
    startCanvasPan({
      event,
      target: elements.canvas,
      svg,
      transform: state.compare.transforms[side],
      commit: (transform) => setCompareTransform(side, transform),
      onEnd({ didPan, cancelled }) {
        if (didPan && !cancelled) services.persistSession({
          label: "Viewport gesture",
          affectedSessionIds: [`compare:${side}`]
        });
      }
    });
  }

  function toggleCompareFocusedRoot(side, nodeId) {
    const roots = normalizeFocusedSelectionRoots(state.compare.focusedRootNodeIds?.[side]);
    const nextRoots = toggleFocusedRootNodeId(roots, nodeId);
    services.setCompareFocusedRootNodeIds(side, nextRoots, nextRoots.includes(nodeId) ? nodeId : null);
    const matchedNode = services.syncCompareFocusedRootNode(side, nodeId, nextRoots.includes(nodeId) ? "add" : "remove");
    setCompareTransform(side, { x: 0, y: 0, scale: 1 });
    services.updateViewControls();
    services.renderCompareGraphs();
    const node = state.compare.fullGraphs?.[side]?.nodes.find((item) => item.id === nodeId);
    const missingMatch = state.compare.focusedRootsSynchronized !== false && nextRoots.includes(nodeId) && !matchedNode;
    services.setStatus(nextRoots.includes(nodeId)
      ? `Added Compare ${side} Focused root: ${node?.label || nodeId}${missingMatch ? " (no matching cell on other side)" : ""}`
      : `Removed Compare ${side} Focused root: ${node?.label || nodeId}`);
  }

  function startCompareNodeDrag(event, side, node) {
    const mount = side === "left" ? elements.leftMount : elements.rightMount;
    services.selectCompareObject(node.kind === "cell" ? "cell" : "port", getCompareNodeName(node), false, side);
    let draggedPosition = state.compare.nodePositions[side].get(node.id);
    startCanvasNodeDrag({
      event,
      target: elements.canvas,
      mount,
      graph: state.compare.graphs[side],
      node,
      getPreviousPosition: () => draggedPosition,
      updatePosition: (position) => { draggedPosition = position; },
      onCommit({ preview }) {
        services.updateCompareOverrides(side, (overrides) => overrides.nodePositions.set(node.id, draggedPosition));
        services.setStatus(`Rerouting ${side} ${node.label}…`);
        runAfterNextPaint(() => {
          preview.clear();
          renderAdjustedCompareSide(side).then((result) => {
            if (!result?.cancelled) services.setStatus(`${side} ${node.label}: position adjusted`);
          });
        });
      }
    });
  }

  function queueWheelGesture(sample) {
    services.wheelGestureController.queue(sample);
  }

  function applyPendingWheelGesture(sample) {
    if (!sample) return;
    if (sample.mode === "compare") {
      const mount = sample.side === "left" ? elements.leftMount : elements.rightMount;
      const svg = mount.querySelector("svg");
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const point = eventPointToSvg(svg, sample);
      setCompareTransform(sample.side, getSteppedZoomedTransform(
        state.compare.transforms[sample.side],
        point,
        sample.steps,
        svg.viewBox.baseVal.width,
        rect.width,
        0.25,
        svg.viewBox.baseVal.height,
        rect.height
      ));
      return;
    }
    const svg = getSvg();
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const point = eventPointToSvg(svg, sample);
    services.setSingleTransform(getSteppedZoomedTransform(
      state.transform,
      point,
      sample.steps,
      svg.viewBox.baseVal.width,
      rect.width,
      0.25,
      svg.viewBox.baseVal.height,
      rect.height
    ));
    services.applyTransform(false);
  }

  function runAfterNextPaint(task) {
    const requestFrame = globalThis.requestAnimationFrame ||
      ((callback) => globalThis.setTimeout(callback, 0));
    requestFrame(() => globalThis.setTimeout(task, 0));
  }

  function renderAdjustedCompareSide(side, renderOptions = {}) {
    const autoGraph = state.compare.autoGraphs[side];
    if (!autoGraph) {
      services.renderCompareGraphs();
      return Promise.resolve();
    }
    const graph = applyWorkspaceOverrides(autoGraph, {
      nodePositions: state.compare.nodePositions[side],
      nodeSizes: state.compare.nodeSizes[side],
      layoutPolicy: state.layoutPolicy
    });
    state.compare.graphs[side] = graph;
    state.compare.scenes[side] = createNetlistScene(graph, { presentationPolicy: state.presentationPolicy });
    const mount = side === "left" ? elements.leftMount : elements.rightMount;
    return services.renderGraphMount(mount, graph, { ...renderOptions, scene: state.compare.scenes[side] }).then((result) => {
      if (result?.cancelled) return result;
      services.applyCompareHighlights();
      applyCompareTransforms();
      services.updateCalibrationControls();
      return result;
    });
  }

  function setCompareTransform(side, transform, synchronize = state.compare.synchronized) {
    services.compareViewSessions.dispatch(side, { type: "viewport.set", viewport: transform });
    if (synchronize) {
      services.compareViewSessions.dispatch(side === "left" ? "right" : "left", {
        type: "viewport.set",
        viewport: transform
      });
    }
    applyCompareTransforms();
  }

  function applyCompareTransforms() {
    for (const side of ["left", "right"]) {
      const mount = side === "left" ? elements.leftMount : elements.rightMount;
      const content = mount.querySelector("#schematicContent");
      if (!content) continue;
      const { x, y, scale } = state.compare.transforms[side];
      content.setAttribute("transform", formatViewportTransform({ x, y, scale }));
      mount.closest(".compare-side")?.classList.toggle("is-low-detail", scale < 0.65);
    }
  }

  function eventPointToSvg(svg, event) {
    const rect = svg.getBoundingClientRect();
    return clientPointToViewBox(
      { x: event.clientX, y: event.clientY },
      rect,
      svg.viewBox.baseVal
    );
  }

  function getSvg() {
    return elements.mount.querySelector("svg");
  }

  function getCurrentLayoutProvider() {
    return getLayoutProvider(state.layoutProviderId);
  }

  return Object.freeze({ handleCompareWheel, handleComparePointerDown, toggleCompareFocusedRoot, startCompareNodeDrag, queueWheelGesture, applyPendingWheelGesture, runAfterNextPaint, renderAdjustedCompareSide, setCompareTransform, applyCompareTransforms, eventPointToSvg, getSvg, getCurrentLayoutProvider });
}

export const compareCanvasPorts = Object.freeze({
  state: [
    "calibrationMode", "compare", "layoutPolicy", "layoutProviderId", "presentationPolicy", "transform"
  ],
  elements: [
    "canvas", "leftMount", "mount", "rightMount"
  ],
  services: [
    "applyCompareHighlights", "applyTransform", "compareViewSessions", "persistSession",
    "renderCompareGraphs", "renderGraphMount", "selectCompareObject", "setCompareFocusedRootNodeIds",
    "setSingleTransform", "setStatus", "syncCompareFocusedRootNode", "updateCalibrationControls",
    "updateCompareOverrides", "updateViewControls", "wheelGestureController"
  ]
});
