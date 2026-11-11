import { sanitizeDownloadFileName } from "../platform/browser_download.js";
import { createStandaloneSvg } from "../render/svgExport.js";
import { renderSvgScene } from "../render/svg_scene_renderer.js";
import { createEmptyGraphOverrides } from "./appState.js";
import { resolveLayoutGoldenModule, applyLayoutGoldenState } from "./layoutGoldenImport.js";
import { compareLayoutGraphs, createLayoutGolden } from "../domains/netlist/layout_golden.js";
import { createSourceIdentity } from "../persistence/source_identity.js";
import { findCompareNode } from "./compareWorkspace.js";

// Legacy workbench adapter. State and elements are restricted ports supplied
// by the composition root; peer actions are explicit, late-bound services.
export function createGoldenController({ state, elements, services }) {
  function exportCurrentSvg() {
    if (state.compare.active || state.compare.singleWorkspaceInvalidated) {
      services.setStatus("Exit Compare before exporting the Single SVG");
      return;
    }
    if (!state.graph || !state.currentModule || !state.singleWorkspaceIdentity) {
      services.setStatus("Wait for the current Single workspace before exporting SVG");
      return;
    }
    const viewSuffix = state.viewMode === "whole"
      ? "whole"
      : `${state.viewMode}-depth-${state.coneDepth}`;
    const fileName = `${sanitizeDownloadFileName(state.currentModule.name)}-${viewSuffix}.svg`;
    services.browserDownload.text(createStandaloneSvg(renderSvgScene(state.scene)), fileName, "image/svg+xml");
    services.logProcess("info", "export", `Exported SVG: ${fileName}`, {
      nodeCount: state.graph.nodes.length,
      edgeCount: state.graph.edges.length
    });
    services.setStatus(`Exported SVG: ${fileName}`);
  }

  function toggleCalibrationMode() {
    state.calibrationMode = !state.calibrationMode;
    updateCalibrationControls();
    services.setStatus(state.calibrationMode ? "Layout calibration mode enabled" : "Layout calibration mode disabled");
  }

  function resetLayoutOverrides() {
    return services.runViewHistoryTransaction({ label: "Reset layout overrides" }, resetLayoutOverridesImpl);
  }

  function resetLayoutOverridesImpl() {
    if (state.compare.active) {
      for (const side of ["left", "right"]) {
        services.setCompareOverrides(side, {
          nodePositions: new Map(),
          nodeSizes: new Map(),
          graphOverrides: createEmptyGraphOverrides()
        });
      }
      services.renderCompareGraphs();
      updateCalibrationControls();
      services.setStatus("Compare Adjust overrides cleared");
      return;
    }
    if (state.nodePositions.size === 0 && state.nodeSizes.size === 0 && services.countGraphOverrides() === 0) {
      return;
    }

    const selectedNode = state.selectedNodeId;
    services.setSingleOverrides({
      nodePositions: new Map(),
      nodeSizes: new Map(),
      graphOverrides: createEmptyGraphOverrides()
    });
    services.renderCurrentModuleGraph();
    services.setSelectedNode(selectedNode);
    services.applyTransform();
    services.setStatus("Adjust overrides cleared");
  }

  function loadLayoutGolden(imported, label) {
    return services.runViewHistoryTransaction({ label: `Load Golden: ${label}` }, () => loadLayoutGoldenImpl(imported, label));
  }

  function loadLayoutGoldenImpl(imported, label) {
    const module = resolveLayoutGoldenModule(state.design, imported, currentPersistenceIdentity());

    if (state.compare.active) services.exitCompareView({ deferSingleRender: true });
    if (state.currentModule?.name !== module.name) services.selectModule(module.name, { deferRender: true });
    applyLayoutGoldenState(state, imported);
    services.setSingleOverrides({
      nodePositions: state.nodePositions,
      nodeSizes: state.nodeSizes,
      graphOverrides: state.graphOverrides
    });
    services.setSingleLayoutPolicy(state.layoutPolicy);

    elements.coneDepthInput.value = String(state.coneDepth);
    elements.faninDepthInput.value = String(state.faninDepth);
    elements.fanoutDepthInput.value = String(state.fanoutDepth);
    services.syncLayoutSpacingControls();
    services.setSingleTransform({ x: 0, y: 0, scale: 1 });
    services.setSelectedNode(null);
    services.updateViewControls();
    const completion = new Promise((resolve, reject) => services.renderCurrentModuleGraph({
      readyMessage: `Loaded Golden ${label}: ${state.nodePositions.size} node position(s)`,
      onRendered: resolve,
      onFailed: reject,
      onCancelled: () => reject(createImportCancellationError("Golden render was cancelled"))
    }));
    services.renderStats();
    services.renderDiagnostics();
    updateCalibrationControls();
    return completion;
  }

  function saveLayoutGolden() {
    if (!state.graph || !state.currentModule || !state.singleWorkspaceIdentity || state.compare.singleWorkspaceInvalidated) {
      services.setStatus("Wait for the current Single workspace before saving a Golden");
      return;
    }

    const diff = compareLayoutGraphs(state.autoGraph, state.graph);
    const golden = createLayoutGolden(state.graph, {
      identity: currentPersistenceIdentity(),
      layoutOptions: {
        layoutPolicy: state.layoutPolicy,
        graphOverrides: state.graphOverrides,
        timingBadgeChoices: state.timingBadgeChoices,
        timingBadgePositions: state.timingBadgePositions,
        display: {
          viewMode: state.viewMode,
          coneRootNodeId: state.coneRootNodeId,
          focusedRootNodeIds: state.focusedRootNodeIds,
          focusedRootRefs: state.focusedRootRefs,
          activeFocusedRootNodeId: state.activeFocusedRootNodeId,
          coneDepth: state.coneDepth,
          faninDepth: state.faninDepth,
          fanoutDepth: state.fanoutDepth,
          useFanoutHubs: state.useFanoutHubs,
        }
      },
      svgSnapshot: renderSvgScene(state.scene)
    });
    services.browserDownload.json(
      {
        ...golden,
        diff
      },
      `layout-golden-${sanitizeDownloadFileName(state.currentModule.name)}.json`
    );
    services.logProcess("info", "export", `Exported layout Golden for ${state.currentModule.displayName}`, {
      movedNodeCount: diff.movedNodeCount,
      maxMove: diff.maxMove
    });
    services.setStatus(`Saved layout golden: ${diff.movedNodeCount} moved node(s), max move ${diff.maxMove}px`);
  }

  function currentPersistenceIdentity() {
    return {
      domainId: state.document?.domainId || "netlist",
      documentId: state.document?.documentId || null,
      unitId: state.currentModule?.name || null,
      sourceIdentity: state.sourceIdentity || createSourceIdentity(
        state.currentSourceLabel || state.document?.source?.name,
        state.currentSource
      )
    };
  }

  function updateCalibrationControls() {
    elements.canvas.classList.toggle("is-calibrating", state.calibrationMode);
    elements.adjustLayoutButton.classList.toggle("is-active", state.calibrationMode);
    elements.adjustLayoutButton.setAttribute("aria-pressed", String(state.calibrationMode));
    const singleWorkspaceUnavailable = state.compare.singleWorkspaceInvalidated || !state.singleWorkspaceIdentity;
    elements.saveGoldenButton.disabled = state.compare.active || !state.graph || singleWorkspaceUnavailable;
    elements.exportSvgButton.disabled = state.compare.active || !state.graph || singleWorkspaceUnavailable;
    elements.resetLayoutButton.disabled = state.compare.active
      ? !services.hasCompareLayoutOverrides()
      : state.nodePositions.size === 0 && state.nodeSizes.size === 0 && services.countGraphOverrides() === 0;
    if (state.compare.active && state.compare.selectedSide && state.compare.selectedName) {
      if (state.compare.selectedKind === "net") {
        services.renderNetSelection(state.compare.selectedName, state.compare.selectedSide);
        return;
      }
      const node = findCompareNode(
        state.compare.graphs[state.compare.selectedSide],
        state.compare.selectedKind,
        state.compare.selectedName
      );
      if (node) services.renderCompareSelection(state.compare.selectedSide, node);
    } else if (!state.compare.active && state.selectedNet) {
      services.renderNetSelection(state.selectedNet);
    } else {
      services.renderSelection(state.graph?.nodes.find((item) => item.id === state.selectedNodeId) || null);
    }
  }

  return Object.freeze({ exportCurrentSvg, toggleCalibrationMode, resetLayoutOverrides, resetLayoutOverridesImpl, loadLayoutGolden, loadLayoutGoldenImpl, saveLayoutGolden, currentPersistenceIdentity, updateCalibrationControls });
}

export const goldenPorts = Object.freeze({
  state: [
    "activeFocusedRootNodeId", "activeSearchResult", "autoGraph", "calibrationMode",
    "collapseLargeGroups", "compare", "compareWorkspaces", "coneDepth", "coneRootNodeId",
    "currentModule", "currentSource", "currentSourceLabel", "design", "document", "expandedGroupIds",
    "faninDepth", "fanoutDepth", "focusedRootNodeIds", "focusedRootRefs", "fullGraph", "graph",
    "graphOverrides", "layoutPolicy", "moduleWorkspaces", "nodePositions", "nodeSizes",
    "occurrenceContext", "restoringViewHistory", "scene", "searchResults", "selectedNet",
    "selectedNodeId", "singleWorkspaceIdentity", "sourceIdentity", "timing", "timingBadgeChoices", "timingBadgePositions",
    "useFanoutHubs", "viewHistory", "viewMode", "workspaceArtifactCache"
  ],
  elements: [
    "adjustLayoutButton", "canvas", "coneDepthInput", "exportSvgButton", "faninDepthInput", "fanoutDepthInput",
    "resetLayoutButton", "saveGoldenButton"
  ],
  services: [
    "applyTransform", "browserDownload", "countGraphOverrides", "exitCompareView",
    "hasCompareLayoutOverrides", "logProcess", "renderCompareGraphs", "renderCompareSelection",
    "renderCurrentModuleGraph", "renderDiagnostics", "renderNetSelection", "renderSelection", "renderStats",
    "runViewHistoryTransaction", "selectModule", "setCompareOverrides", "setSelectedNode",
    "setSingleLayoutPolicy", "setSingleOverrides", "setSingleTransform", "setStatus",
    "syncLayoutSpacingControls", "updateViewControls"
  ]
});

function createImportCancellationError(message) {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}
