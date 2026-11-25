import { writeProcessLogSafely } from "./processLog.js";
import { warnLegacyCollapse } from "./legacy_display_options.js";
import { pathDisplayBoundaries } from "./show_path_context.js";
import { sanitizeDownloadFileName } from "../platform/browser_download.js";
import { createStandaloneSvg } from "../render/svgExport.js";
import { renderSvgScene } from "../render/svg_scene_renderer.js";
import { createEmptyGraphOverrides } from "./appState.js";
import { resolveLayoutGoldenModule, applyLayoutGoldenState } from "./layoutGoldenImport.js";
import { compareLayoutGraphs, createLayoutGolden } from "../domains/netlist/layout_golden.js";
import { createSourceIdentity } from "../persistence/source_identity.js";
import { findCompareNode } from "./compareWorkspace.js";
import { errorMessage } from "../foundation/log_details.js";

// Legacy workbench adapter. State and elements are restricted ports supplied
// by the composition root; peer actions are explicit, late-bound services.
export function createGoldenController({ state, elements, services, exportScene = (scene) => scene, markExport = (markup) => markup, validateSavedPath }) {
  function exportCurrentSvg(requestedSide, capture = false) {
    const side = state.compare.active && ["left", "right"].includes(requestedSide) ? requestedSide : null;
    if (!side && (state.compare.active || state.compare.singleWorkspaceInvalidated)) {
      if (capture) throw Object.assign(new Error("Choose a committed Compare side to export"),{code:"WORKSPACE_UNAVAILABLE"});
      services.setStatus("Exit Compare before exporting the Single SVG");
      return;
    }
    const graph = side ? state.compare.graphs[side] : state.graph;
    if (!graph || (side ? !state.compare.workspaceIdentity : !state.currentModule || !state.singleWorkspaceIdentity)) {
      if (capture) throw Object.assign(new Error("The requested workspace is not ready to export"),{code:"WORKSPACE_UNAVAILABLE"});
      services.setStatus("Wait for the current Single workspace before exporting SVG");
      return;
    }
    const unit = side ? graph.moduleName : state.currentModule.name;
    const mode = side ? graph.view?.mode || "whole" : state.viewMode;
    const viewSuffix = side ? side + "-" + mode : mode === "whole" ? "whole" : mode + "-depth-" + state.coneDepth;
    const fileName = `${sanitizeDownloadFileName(unit)}-${viewSuffix}.svg`;
    try {
      const scene = renderSvgScene(exportScene(side ? state.compare.scenes[side] : state.scene, side));
      const display = graph.path ? { boundaries: pathDisplayBoundaries(graph), visible: new Set(graph.nodes.map((n) => n.id)), truncated: graph.view?.truncated } : {};
      const svg = createStandaloneSvg(markExport(scene, side), graph.path, [unit, side, mode].filter(Boolean).join(" · "), display);
      if (capture) return {name:fileName,text:svg,mime:"image/svg+xml"};
      services.browserDownload.text(svg, fileName, "image/svg+xml");
    } catch (error) {
      if (capture) throw error;
      reportExportFailure(error, "export-svg", fileName, { side, moduleName: unit, view: mode });
      return;
    }
    services.logProcess("info", "export", `Exported SVG: ${fileName}`, {
      nodeCount: graph.nodes.length, edgeCount: graph.edges.length, side
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

    if (imported.display.showPath) validateSavedPath?.(imported.display.showPath, module, imported.display.occurrenceContext, imported.graphOverrides);
    if (state.compare.active) services.exitCompareView({ deferSingleRender: true });
    const occurrence = imported.display.occurrenceContext;
    if (state.currentModule?.name !== module.name || imported.display.showPath || occurrence) {
      services.selectModule(module.name, { deferRender: true, ...(imported.display.showPath || occurrence
        ? { occurrencePath: occurrence?.occurrencePath || [], rootModuleName: occurrence?.rootModuleName } : {}) });
    }
    warnLegacyCollapse(imported.display, services.logProcess, "golden.restore");
    applyLayoutGoldenState(state, imported, (value) => services.singleViewSession.importNavigation(value));
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

  function saveLayoutGolden(capture = false) {
    if (!state.graph || !state.currentModule || !state.singleWorkspaceIdentity || state.compare.singleWorkspaceInvalidated) {
      if (capture === true) throw Object.assign(new Error("Single workspace is not ready"), {code:"WORKSPACE_UNAVAILABLE"});
      services.setStatus("Wait for the current Single workspace before saving a Golden");
      return;
    }

    const fileName = `layout-golden-${sanitizeDownloadFileName(state.currentModule.name)}.json`;
    try {
      return exportLayoutGolden(fileName, capture === true);
    } catch (error) {
      if (capture === true) throw error;
      reportExportFailure(error, "export-golden", fileName);
    }
  }

  function exportLayoutGolden(fileName, capture) {
    const diff = compareLayoutGraphs(state.autoGraph, state.graph);
    const golden = createLayoutGolden(state.graph, {
      identity: currentPersistenceIdentity(),
      layoutOptions: {
        layoutPolicy: state.layoutPolicy,
        graphOverrides: state.graphOverrides,
        timingBadgeChoices: state.timingBadgeChoices,
        timingBadgePositions: state.timingBadgePositions,
        display: {
          ...(state.showPath || state.occurrenceContext ? { showPath: state.showPath, occurrenceContext: state.occurrenceContext } : {}), viewMode: state.viewMode,
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
    const value = { ...golden, diff };
    if (capture) return {text:JSON.stringify(value, null, 2), name:fileName, mime:"application/json"};
    services.browserDownload.json(value, fileName);
    services.logProcess("info", "export", `Exported layout Golden for ${state.currentModule.displayName}`, {
      movedNodeCount: diff.movedNodeCount,
      maxMove: diff.maxMove
    });
    services.setStatus(`Saved layout golden: ${diff.movedNodeCount} moved node(s), max move ${diff.maxMove}px`);
  }

  function reportExportFailure(error, operation, fileName, scope = {}) {
    const message = `${operation === "export-svg" ? "SVG" : "Layout Golden"} export failed: ${errorMessage(error)}`;
    writeProcessLogSafely(services.logProcess, "error", "export", message, {
      error, operation, code: operation === "export-svg" ? "svg.export-failed" : "golden.export-failed", fileName, moduleName: state.currentModule?.name, view: state.viewMode, ...scope
    });
    services.setStatus(message);
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
    "compare", "compareWorkspaces", "coneDepth", "coneRootNodeId",
    "currentModule", "currentSource", "currentSourceLabel", "design", "document",
    "faninDepth", "fanoutDepth", "focusedRootNodeIds", "focusedRootRefs", "fullGraph", "graph", "showPath",
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
    "singleViewSession",
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
