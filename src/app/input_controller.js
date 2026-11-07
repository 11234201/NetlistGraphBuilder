import { fetchStartupManifest, executeStartupManifest } from "./startupController.js";
import { sampleNetlist } from "./sampleNetlist.js";
import { DEFAULT_LAYOUT_PROVIDER_ID } from "../layout/providerDefaults.js";
import { parseCellConfig } from "../infer/cellConfig.js";
import { getLayoutGoldenState } from "../domains/netlist/layout_golden.js";
import { importTimingSource } from "../domains/netlist/timing_import.js";
import {
  resetTimingPresentation,
  resetDesignWorkspace,
  normalizeFocusedRootNodeIds,
  setFocusedRootNodeIds
} from "./appState.js";
import { importDesignSource } from "./designInput.js";
import { createSourceIdentity } from "../persistence/source_identity.js";
import { normalizeSingleViewMode } from "./singleViewMode.js";

// Legacy workbench adapter. State and elements are restricted ports supplied
// by the composition root; peer actions are explicit, late-bound services.
export function createInputController({ state, elements, services }) {
  async function initializeApplication(session) {
    try {
      const manifest = await fetchStartupManifest(globalThis.location?.search || "");
      if (!manifest) {
        loadDesign(session?.source || sampleNetlist, session?.sourceLabel || "built-in sample", session);
        return;
      }
      services.logProcess("info", "launcher", "Applying EDA startup manifest");
      await executeStartupManifest(manifest, createStartupHandlers());
    } catch (error) {
      services.logProcess("error", "launcher", `Startup failed: ${error.message}`);
      if (!state.currentModule) loadDesign(sampleNetlist, "built-in sample");
    }
  }

  function createStartupHandlers() {
    return {
      configureTarget(target) {
        state.layoutProviderId = DEFAULT_LAYOUT_PROVIDER_ID;
        state.layoutFallbackFromProviderId = null;
        elements.layoutProviderSelect.value = state.layoutProviderId;
        if (target.faninDepth !== undefined) state.faninDepth = target.faninDepth;
        if (target.fanoutDepth !== undefined) state.fanoutDepth = target.fanoutDepth;
        elements.faninDepthInput.value = String(state.faninDepth);
        elements.fanoutDepthInput.value = String(state.fanoutDepth);
      },
      loadCellConfig(input) {
        state.cellConfig = parseCellConfig(input.text);
        services.logProcess("info", "launcher", `Applied Cell Config ${input.name}`, {
          definitionCount: Object.keys(state.cellConfig.cells).length
        });
      },
      loadNetlist(input, target) {
        return new Promise((resolve, reject) => {
          try {
            loadDesign(input.text, input.name, {
              moduleName: target.module,
              onRendered: resolve,
              onFailed: reject,
              onCancelled: () => reject(createStartupCancellationError())
            });
            if (target.module && state.currentModule?.name !== target.module && state.currentModule?.displayName !== target.module) {
              reject(new Error(`Startup module not found: ${target.module}`));
            }
          } catch (error) {
            reject(error);
          }
        });
      },
      loadTiming(input) {
        loadTimingText(input.text, input.name);
      },
      ensureDesign() {
        if (state.currentModule) return undefined;
        return new Promise((resolve, reject) => loadDesign(sampleNetlist, "built-in sample", {
          onRendered: resolve,
          onFailed: reject,
          onCancelled: () => reject(createStartupCancellationError())
        }));
      },
      selectModule: services.selectStartupModule,
      focusCell: services.focusStartupCell,
      focusCells: services.focusStartupCells,
      ready(manifest) {
        const detail = {
          module: state.currentModule?.name || null,
          focus: manifest.target.focus || null,
          faninDepth: state.faninDepth,
          fanoutDepth: state.fanoutDepth
        };
        globalThis.__NGB_STARTUP_READY__ = detail;
        globalThis.dispatchEvent?.(new CustomEvent("ngb-startup-ready", { detail }));
        services.logProcess("info", "launcher", `EDA startup ready: ${detail.module}`, detail);
      }
    };
  }

  function loadQuickInputText(text, options = {}) {
    const kind = options.kind;
    const label = options.label || options.name || "quick input";
    if (kind === "netlist") {
      loadDesign(text, label);
      return kind;
    }
    if (kind === "golden") {
      services.loadLayoutGolden(getLayoutGoldenState(text), label);
      return kind;
    }

    loadTimingText(text, label);
    return kind;
  }

  function loadTimingText(text, label) {
    services.logProcess("info", "timing", `Parsing timing ${label}`);
    let imported;
    try {
      imported = importTimingSource(text, { name: label });
    } catch (error) {
      services.logProcess("error", "timing", `Timing parse failed: ${error.message}`, { label });
      throw error;
    }
    state.timing = imported.timing;
    services.logProcess("info", "timing", `Loaded ${imported.summary.recordCount} timing scope(s)`, {
      label,
      format: imported.summary.format,
      diagnostics: imported.summary.diagnosticCount
    });
    resetTimingPresentation(state);
    if (state.compare.active) {
      services.renderCompareGraphs();
      services.renderStats();
      services.setStatus(`Loaded timing ${label}: ${state.timing.instanceCount} instance(s)`);
      return;
    }
    if (state.currentModule) {
      services.rerenderPreservingView(state.selectedNodeId);
      services.renderStats();
    }
    services.setStatus(`Loaded timing ${label}: ${state.timing.instanceCount} instance(s)`);
  }

  function loadDesign(source, label, restore = null) {
    services.logProcess("info", "import", `Loading design ${label}`);
    let documentEnvelope;
    try {
      documentEnvelope = importDesignSource(source, {
        name: label,
        documentId: "document:primary",
        sourceRevision: (state.document?.sourceRevision || 0) + 1
      });
    } catch (error) {
      services.logProcess("error", "parse", `Design parse failed: ${error.message}`, { label });
      services.setStatus(`Parse failed: ${error.message}`);
      throw error;
    }

    try {
      const design = documentEnvelope.model;
      services.logProcess("info", "parse", `Parsed ${design.modules.length} module(s)`, {
        label,
        diagnostics: design.diagnostics?.length || 0
      });
      if (state.document?.documentId) services.workspaceJobs.cancelDocument(state.document.documentId);
      state.document = services.documents.open(documentEnvelope);
      services.viewSessions.closeByDocument(documentEnvelope.documentId);
      state.design = design;
      state.currentSource = source;
      state.currentSourceLabel = label;
      state.sourceIdentity = createSourceIdentity(label, source);
      resetDesignWorkspace(state);
      state.currentModule = null;
      state.searchIndex = services.netlistFeature.buildSearchIndex(documentEnvelope);
      services.clearSearch();
      if (restore?.searchQuery) {
        state.searchQuery = restore.searchQuery;
        elements.searchInput.value = restore.searchQuery;
        services.handleSearchInput();
      }
      services.renderModuleOptions();
      const firstModule = state.design.modules.find((module) => module.name === restore?.moduleName)
        || state.design.modules[0];
      const readyMessage = `Loaded ${label}: ${state.design.modules.length} module(s)`;
      services.selectModule(firstModule.name, { historyMode: "restore", deferRender: true });
      const restoredFocusedRoots = normalizeFocusedRootNodeIds(
        restore?.focusedRootNodeIds,
        restore?.coneRootNodeId
      );
      state.focusedRootRefs = services.cloneObjectRefs(restore?.focusedRootRefs);
      if (Number.isFinite(Number(restore?.coneDepth))) state.coneDepth = Number(restore.coneDepth);
      if (Number.isFinite(Number(restore?.faninDepth))) state.faninDepth = Number(restore.faninDepth);
      if (Number.isFinite(Number(restore?.fanoutDepth))) state.fanoutDepth = Number(restore.fanoutDepth);
      elements.coneDepthInput.value = String(state.coneDepth);
      elements.faninDepthInput.value = String(state.faninDepth);
      elements.fanoutDepthInput.value = String(state.fanoutDepth);
      const restoredViewMode = restore?.viewMode ? normalizeSingleViewMode(restore.viewMode) : null;
      if (restoredViewMode && (restoredViewMode !== "focused" || restoredFocusedRoots.length > 0)) {
        state.viewMode = restoredViewMode;
        setFocusedRootNodeIds(
          state,
          restoredViewMode === "focused" ? restoredFocusedRoots : [],
          restore.activeFocusedRootNodeId
        );
      }
      if (restore?.transform) services.setSingleTransform(restore.transform);
      services.renderCurrentModuleGraph({
        readyMessage,
        onRendered: restore?.onRendered,
        onFailed: restore?.onFailed,
        onCancelled: restore?.onCancelled
      });
      services.renderStats();
      services.setStatus(readyMessage);
    } catch (error) {
      services.setStatus(`Load failed: ${error.message}`);
      throw error;
    }
  }

  return Object.freeze({ initializeApplication, createStartupHandlers, loadQuickInputText, loadTimingText, loadDesign });
}

function createStartupCancellationError() {
  const error = new Error("Startup render was cancelled");
  error.name = "AbortError";
  return error;
}

export const inputPorts = Object.freeze({
  state: [
    "activeFocusedRootNodeId", "activeSearchResult", "autoGraph", "cellConfig", "compare",
    "compareWorkspaces", "coneDepth", "coneRootNodeId", "currentModule", "currentSource", "currentSourceLabel",
    "design", "document", "expandedGroupIds", "faninDepth", "fanoutDepth", "focusedRootNodeIds",
    "focusedRootRefs", "fullGraph", "graph", "graphOverrides", "layoutFallbackFromProviderId",
    "layoutProviderId", "moduleWorkspaces", "nodePositions", "nodeSizes", "occurrenceContext",
    "restoringViewHistory", "scene", "searchIndex", "searchQuery", "searchResults", "selectedNet",
    "selectedNodeId", "singleWorkspaceIdentity", "sourceIdentity", "timing", "timingBadgeChoices", "timingBadgePositions",
    "viewHistory", "viewMode", "workspaceArtifactCache"
  ],
  elements: [
    "coneDepthInput", "faninDepthInput", "fanoutDepthInput", "layoutProviderSelect", "searchInput"
  ],
  services: [
    "clearSearch", "cloneObjectRefs", "documents", "focusStartupCell", "focusStartupCells",
    "handleSearchInput", "loadLayoutGolden", "logProcess", "netlistFeature", "renderCompareGraphs",
    "renderCurrentModuleGraph", "renderModuleOptions", "renderStats", "rerenderPreservingView",
    "selectModule", "selectStartupModule", "setSingleTransform", "setStatus", "viewSessions",
    "workspaceJobs"
  ]
});
