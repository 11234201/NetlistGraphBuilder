import { fetchStartupManifest, executeStartupManifest } from "./startupController.js";
import { sampleNetlist } from "./sampleNetlist.js";
import { sampleTiming } from "./sampleTiming.js";
import { DEFAULT_LAYOUT_PROVIDER_ID } from "../layout/providerDefaults.js";
import { parseCellConfig } from "../infer/cellConfig.js";
import { getLayoutGoldenState } from "../domains/netlist/layout_golden.js";
import { importTimingSource } from "../domains/netlist/timing_import.js";
import {
  resetTimingPresentation,
  resetDesignWorkspace,
  normalizeFocusedRootNodeIds
} from "./appState.js";
import { importDesignSource } from "./designInput.js";
import { createSourceIdentity } from "../persistence/source_identity.js";
import { normalizeSingleViewMode } from "./singleViewMode.js";

// Legacy workbench adapter. State and elements are restricted ports supplied
// by the composition root; peer actions are explicit, late-bound services.
export function createInputController({ state, elements, services, restoreComparePath, validateSavedPath }) {
  async function initializeApplication(session) {
    const request = services.importRequests.begin();
    try {
      const manifest = await fetchStartupManifest(globalThis.location?.search || "", undefined, { signal: request.signal });
      if (!request.isCurrent()) return;
      if (!manifest) {
        await loadDesign(session?.source || sampleNetlist, session?.sourceLabel || "built-in sample", session);
        if (session?.comparePathView && !session.pathSourceUnverified && request.isCurrent() && session.sourceIdentity?.fingerprint === state.sourceIdentity?.fingerprint) await restoreComparePath?.(session.comparePathView);
        return;
      }
      services.logProcess("info", "launcher", "Applying EDA startup manifest");
      await executeStartupManifest(manifest, createStartupHandlers(), { signal: request.signal });
    } catch (error) {
      if (!request.isCurrent() || error?.name === "AbortError") return;
      services.logProcess("error", "launcher", `Startup failed: ${error.message}`, { error });
      if (!state.currentModule) await loadDesign(sampleNetlist, "built-in sample");
    }
  }

  function createStartupHandlers() {
    return {
      configureTarget(target) {
        state.layoutProviderId = DEFAULT_LAYOUT_PROVIDER_ID;
        state.layoutFallbackFromProviderId = null;
        elements.layoutProviderSelect.value = state.layoutProviderId;
        services.singleViewSession.importQuery({ faninDepth: target.faninDepth, fanoutDepth: target.fanoutDepth });
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
        return loadDesign(input.text, input.name, { moduleName: target.module });
      },
      loadTiming(input) {
        return loadTimingText(input.text, input.name);
      },
      ensureDesign() {
        if (state.currentModule) return undefined;
        return loadDesign(sampleNetlist, "built-in sample");
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
    const signal = options.request?.signal;
    if (signal?.aborted) return Promise.reject(createStartupCancellationError("Input cancelled"));
    if (kind === "netlist") {
      return loadDesign(text, label, null, { signal }).then(() => kind);
    }
    if (kind === "golden") {
      return Promise.resolve(services.loadLayoutGolden(getLayoutGoldenState(text), label)).then(() => kind);
    }

    return Promise.resolve(loadTimingText(text, label, { signal })).then(() => kind);
  }

  function loadTimingText(text, label, { signal } = {}) {
    services.logProcess("info", "timing", `Parsing timing ${label}`);
    let imported;
    try {
      imported = importTimingSource(text, { name: label });
    } catch (error) {
      services.logProcess("error", "timing", `Timing parse failed: ${error.message}`, { label, error });
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
      return new Promise((resolve, reject) => services.renderCompareGraphs({
        signal,
        onCommitted: (graphs) => {
          services.renderStats();
          services.setStatus(`Loaded timing ${label}: ${state.timing.instanceCount} instance(s)`);
          resolve(graphs);
        },
        onFailed: reject,
        onCancelled: () => reject(createStartupCancellationError("Timing render was cancelled"))
      }));
    }
    if (state.currentModule) {
      return new Promise((resolve, reject) => services.rerenderPreservingView(state.selectedNodeId, {
        signal,
        onRendered: (graph) => {
          services.renderStats();
          services.setStatus(`Loaded timing ${label}: ${state.timing.instanceCount} instance(s)`);
          resolve(graph);
        },
        onFailed: reject,
        onCancelled: () => reject(createStartupCancellationError("Timing render was cancelled"))
      }));
    }
    services.setStatus(`Loaded timing ${label}: ${state.timing.instanceCount} instance(s)`);
    return Promise.resolve(null);
  }

  function loadDesign(source, label, restore = null, { signal } = {}) {
    services.logProcess("info", "import", `Loading design ${label}`);
    let documentEnvelope;
    try {
      documentEnvelope = importDesignSource(source, {
        name: label,
        documentId: "document:primary",
        sourceRevision: (state.document?.sourceRevision || 0) + 1
      });
    } catch (error) {
      services.logProcess("error", "parse", `Design parse failed: ${error.message}`, { label, error });
      services.setStatus(`Parse failed: ${error.message}`);
      throw error;
    }

    try {
      const design = documentEnvelope.model;
      if (restore?.moduleName && !design.modules.some((module) =>
        module.name === restore.moduleName || module.displayName === restore.moduleName)) {
        throw new Error(`Startup module not found: ${restore.moduleName}`);
      }
      services.logProcess("info", "parse", `Parsed ${design.modules.length} module(s)`, {
        label,
        diagnostics: design.diagnostics?.length || 0
      });
      if (state.compare.active) services.exitCompareView({ deferSingleRender: true });
      if (state.document?.documentId) services.workspaceJobs.cancelDocument(state.document.documentId);
      state.document = services.documents.open(documentEnvelope);
      services.viewSessions.closeByDocument(documentEnvelope.documentId);
      state.design = design;
      state.currentSource = source;
      state.currentSourceLabel = label;
      state.sourceIdentity = createSourceIdentity(label, source);
      if ((restore?.showPath || restore?.comparePathView) && (restore.pathSourceUnverified || restore.sourceIdentity?.fingerprint !== state.sourceIdentity.fingerprint)) {
        services.logProcess("warning", "persistence", "Source changed; saved Show Path endpoints cleared", {
          operation: "show-path.restore", code: "show-path.source-mismatch", moduleName: restore.moduleName, documentId: state.document.documentId });
        restore = { ...restore, showPath: null, comparePathView: null, occurrenceContext: null };
      }
      resetDesignWorkspace(state, () => services.singleViewSession.resetNavigation());
      services.compareViewSessions.resetState();
      state.currentModule = null;
      state.searchIndex = services.netlistFeature.buildSearchIndex(documentEnvelope);
      services.clearSearch();
      if (restore?.timing) {
        state.timing = restore.timing;
      } else if (label === "built-in sample" && !restore?.timingDisabled) {
        try {
          const imported = importTimingSource(sampleTiming, { name: "built-in sample timing" });
          state.timing = imported.timing;
        } catch (error) {
          services.logProcess("warning", "timing", "Built-in sample timing could not be loaded", { error });
          state.timing = null;
        }
      }
      if (restore?.searchQuery) {
        state.searchQuery = restore.searchQuery;
        elements.searchInput.value = restore.searchQuery;
        services.handleSearchInput({ openResults: false });
      }
      services.renderModuleOptions();
      const firstModule = state.design.modules.find((module) =>
        module.name === restore?.moduleName || module.displayName === restore?.moduleName)
        || state.design.modules[0];
      const readyMessage = state.timing
        ? `Loaded ${label}: ${state.design.modules.length} module(s), timing: ${state.timing.instanceCount} instance(s)`
        : `Loaded ${label}: ${state.design.modules.length} module(s)`;
      services.selectModule(firstModule.name, { historyMode: "restore", deferRender: true,
        ...(restore?.occurrenceContext || {}) });
      if (restore?.showPath) {
        try { validateSavedPath?.(restore.showPath, firstModule, restore.occurrenceContext); }
        catch (error) {
          services.logProcess("warning", "persistence", "Saved Show Path could not be restored", {
            operation: "show-path.restore", code: error.code, error, documentId: state.document.documentId, moduleName: firstModule.name });
          restore = { ...restore, showPath: null };
        }
      }
      const restoredFocusedRoots = normalizeFocusedRootNodeIds(
        restore?.focusedRootNodeIds,
        restore?.coneRootNodeId
      );
      const restoredQuery = {};
      for (const key of ["coneDepth", "faninDepth", "fanoutDepth"]) {
        if (Number.isFinite(Number(restore?.[key]))) restoredQuery[key] = Number(restore[key]);
      }
      const restoredViewMode = restore?.viewMode ? normalizeSingleViewMode(restore.viewMode) : null;
      if (restoredViewMode && (restoredViewMode !== "focused" || restoredFocusedRoots.length > 0)) {
        services.singleViewSession.importNavigation({
          ...restoredQuery, showPath: restore.showPath || null, viewMode: restoredViewMode,
          focusedRootNodeIds: restoredViewMode === "focused" ? restoredFocusedRoots : [],
          focusedRootRefs: restore?.focusedRootRefs,
          activeFocusedRootNodeId: restore.activeFocusedRootNodeId
        });
      } else services.singleViewSession.importQuery(restoredQuery);
      elements.coneDepthInput.value = String(state.coneDepth);
      elements.faninDepthInput.value = String(state.faninDepth);
      elements.fanoutDepthInput.value = String(state.fanoutDepth);
      if (restore?.unroutedNets) services.setSingleOverrides({
        nodePositions: state.nodePositions,
        nodeSizes: state.nodeSizes,
        graphOverrides: { ...state.graphOverrides, unroutedNets: restore.unroutedNets }
      });
      if (restore?.transform) services.setSingleTransform(restore.transform);
      const completion = new Promise((resolve, reject) => services.renderCurrentModuleGraph({
        signal,
        readyMessage,
        onRendered: (graph) => {
          services.recordViewHistory({ label: "Open document" });
          restore?.onRendered?.(graph);
          resolve(graph);
        },
        onFailed: (error) => {
          restore?.onFailed?.(error);
          reject(error);
        },
        onCancelled: () => {
          restore?.onCancelled?.();
          reject(createStartupCancellationError());
        }
      }));
      services.renderStats();
      return completion;
    } catch (error) {
      services.logProcess("error", "import", `Load failed: ${error.message}`, { label, error });
      services.setStatus(`Load failed: ${error.message}`);
      throw error;
    }
  }

  return Object.freeze({ initializeApplication, createStartupHandlers, loadQuickInputText, loadTimingText, loadDesign });
}

function createStartupCancellationError(message = "Startup render was cancelled") {
  const error = new Error(message);
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
    "compareViewSessions",
    "clearSearch", "documents", "focusStartupCell", "focusStartupCells", "importRequests",
    "singleViewSession", "exitCompareView", "handleSearchInput", "loadLayoutGolden", "logProcess", "netlistFeature", "renderCompareGraphs",
    "recordViewHistory", "renderCurrentModuleGraph", "renderModuleOptions", "renderStats", "rerenderPreservingView",
    "selectModule", "selectStartupModule", "setSingleOverrides", "setSingleTransform", "setStatus", "viewSessions",
    "workspaceJobs"
  ]
});
