import { normalizeLayoutPolicy } from "../layout/layoutPolicy.js";
import { normalizeNetlistPresentationPolicy } from "../domains/netlist/netlist_presentation_policy.js";
import { createNetlistScene } from "../domains/netlist/netlist_scene.js";

// Legacy workbench adapter. State and elements are restricted ports supplied
// by the composition root; peer actions are explicit, late-bound services.
export function createPresentationController({ state, elements, services }) {
  function handleGraphSimplificationChange() {
    state.useFanoutHubs = elements.fanoutHubsInput.checked;
    rerenderActiveGraph();
  }

  function rerenderActiveGraph() {
    if (state.compare.active) services.renderCompareGraphs();
    else services.renderCurrentModuleGraph();
  }

  function commitLayoutSpacing(key, value) {
    services.setSingleLayoutPolicy(normalizeLayoutPolicy({
      ...state.layoutPolicy,
      spacing: { ...state.layoutPolicy.spacing, [key]: value }
    }));
    services.syncLayoutSpacingControls();
    services.persistSession();
    if (!state.currentModule) return;

    if (key === "wireLanePitch" && state.compare.active) {
      services.renderCompareGraphs();
      services.renderStats();
      services.setStatus(`Wire spacing: ${value}px`);
      return;
    }

    if (key === "cellSpacing") {
      const selectedNodeId = state.selectedNodeId;
      const previousTransform = { ...state.transform };
      rerenderActiveGraph();
      if (!state.compare.active) {
        services.setSingleTransform(previousTransform);
        services.setSelectedNode(selectedNodeId);
        services.applyTransform();
      }
      services.setStatus(`Cell spacing: ${value}px`);
      return;
    }

    const previousTransform = { ...state.transform };
    services.renderCurrentModuleGraph();
    services.setSingleTransform(previousTransform);
    services.renderStats();
    services.renderDiagnostics();
    const selectedNode = state.selectedNodeId;
    services.setSelectedNode(selectedNode);
    services.applyTransform();
    services.setStatus(`Wire spacing: ${value}px`);
  }

  function commitTimingDisplayPolicy(policy) {
    state.timingDisplayPolicy = policy;
    services.persistSession();
    if (state.timing && state.currentModule) rerenderActiveGraph();
    const metric = policy.metrics.length === 0
      ? "none"
      : (policy.metrics.length >= 3 ? "all" : (policy.metrics[0] === "slack" ? "worst slack" : policy.metrics[0]));
    services.setStatus(`Timing: ${metric}`);
  }

  function commitGateSymbolMode(mode) {
    const presentationPolicy = normalizeNetlistPresentationPolicy({
      ...state.presentationPolicy,
      gateSymbolMode: mode
    });
    if (presentationPolicy.gateSymbolMode === state.presentationPolicy?.gateSymbolMode) {
      elements.gateSymbolModeSelect.value = presentationPolicy.gateSymbolMode;
      return;
    }
    state.presentationPolicy = presentationPolicy;
    elements.gateSymbolModeSelect.value = presentationPolicy.gateSymbolMode;
    if (state.document?.documentId && state.currentModule?.name) {
      services.singleViewSession.dispatch({
        type: "presentation.policy.set",
        presentationPolicy
      });
    }
    if (state.compare.active) {
      for (const side of ["left", "right"]) {
        services.compareViewSessions.dispatch(side, {
          type: "presentation.policy.set",
          presentationPolicy
        });
      }
      refreshComparePresentationScenes();
    } else if (state.graph) {
      state.scene = createNetlistScene(state.graph, { presentationPolicy });
      services.renderGraphMount(elements.mount, state.graph, { scene: state.scene }).then((result) => {
        if (result?.cancelled) return;
        services.applyTransform();
        services.updateCalibrationControls();
      }).catch((error) => services.setStatus(`Presentation render failed: ${error.message}`));
    }
    services.persistSession();
    services.setStatus(`Gate symbols: ${presentationPolicy.gateSymbolMode}`);
  }

  function refreshComparePresentationScenes() {
    const renders = [];
    for (const side of ["left", "right"]) {
      const graph = state.compare.graphs[side];
      if (!graph) continue;
      const scene = createNetlistScene(graph, { presentationPolicy: state.presentationPolicy });
      state.compare.scenes[side] = scene;
      const mount = side === "left" ? elements.leftMount : elements.rightMount;
      renders.push(services.renderGraphMount(mount, graph, { scene }));
    }
    Promise.all(renders).then((results) => {
      if (results.some((result) => result?.cancelled)) return;
      services.applyCompareHighlights();
      services.applyCompareTransforms();
      services.updateCalibrationControls();
    }).catch((error) => services.setStatus(`Compare presentation render failed: ${error.message}`));
  }

  return Object.freeze({ handleGraphSimplificationChange, rerenderActiveGraph, commitLayoutSpacing, commitTimingDisplayPolicy, commitGateSymbolMode, refreshComparePresentationScenes });
}

export const presentationPorts = Object.freeze({
  state: [
    "compare", "currentModule", "document", "graph", "layoutPolicy", "presentationPolicy", "scene",
    "selectedNodeId", "timing", "timingDisplayPolicy", "transform", "useFanoutHubs"
  ],
  elements: [
    "fanoutHubsInput", "gateSymbolModeSelect", "leftMount", "mount", "rightMount"
  ],
  services: [
    "applyCompareHighlights", "applyCompareTransforms", "applyTransform", "compareViewSessions",
    "persistSession", "renderCompareGraphs", "renderCurrentModuleGraph", "renderDiagnostics",
    "renderGraphMount", "renderStats", "setSelectedNode", "setSingleLayoutPolicy", "setSingleTransform",
    "setStatus", "singleViewSession", "syncLayoutSpacingControls", "updateCalibrationControls"
  ]
});
