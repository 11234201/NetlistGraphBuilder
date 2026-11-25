import { fetchStartupManifest, executeStartupManifest } from "./startupController.js";
import { sampleNetlist } from "./sampleNetlist.js";
import { sampleTiming } from "./sampleTiming.js";
import { DEFAULT_LAYOUT_PROVIDER_ID } from "../layout/providerDefaults.js";
import { parseCellConfig } from "../infer/cellConfig.js";
import { getLayoutGoldenState } from "../domains/netlist/layout_golden.js";
import { importTimingSource, mergeImportedTiming } from "../domains/netlist/timing_import.js";
import { mergeNetlistSources, formatMergedSourceLabel } from "../domains/netlist/design_merge.js";
import { buildModuleHierarchy } from "../domains/netlist/module_hierarchy.js";
import { recommendModulePair } from "../analysis/moduleCompare.js";
import {
  resetTimingPresentation,
  resetDesignWorkspace,
  normalizeFocusedRootNodeIds
} from "./appState.js";
import { importDesignSource } from "./designInput.js";
import { createSourceIdentity } from "../persistence/source_identity.js";
import { normalizeSingleViewMode } from "./singleViewMode.js";
import { writeTimingLog } from "./timing_match_log.js";

// Legacy workbench adapter. State and elements are restricted ports supplied
// by the composition root; peer actions are explicit, late-bound services.
export function createInputController({ state, elements, services, restoreComparePath, validateSavedPath, compareSideActions = null }) {
  async function initializeApplication(session) {
    const request = services.importRequests.begin();
    try {
      const manifest = await fetchStartupManifest(globalThis.location?.search || "", undefined, { signal: request.signal });
      if (!request.isCurrent()) return;
      if (!manifest) {
        const firstRestoredFile = Array.isArray(session?.sourceFiles)
          ? session.sourceFiles.find((entry) => entry && typeof entry.text === "string")
          : null;
        const startupSource = firstRestoredFile?.text || session?.source || sampleNetlist;
        const startupLabel = firstRestoredFile?.name || session?.sourceLabel || "built-in sample";
        await loadDesign(startupSource, startupLabel, session);
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
    const append = Boolean(options.append);
    const compareSide = options.compareSide || null;
    if (signal?.aborted) return Promise.reject(createStartupCancellationError("Input cancelled"));
    if (kind === "netlist") {
      return loadDesign(text, label, null, { signal, append, compareSide }).then(() => kind);
    }
    if (kind === "golden") {
      return Promise.resolve(services.loadLayoutGolden(getLayoutGoldenState(text), label)).then(() => kind);
    }

    return Promise.resolve(loadTimingText(text, label, { signal, append, compareSide })).then(() => kind);
  }

  function loadTimingText(text, label, { signal, append = false, compareSide = null } = {}) {
    const context = { operation: "timing.import", fileName: label, compareSide, append,
      documentId: state.document?.documentId, documentRevision: state.document?.sourceRevision };
    writeTimingLog(services.logProcess, "info", `Parsing timing ${label}`, { ...context, code: "timing.parse-started" });
    let imported;
    try {
      imported = importTimingSource(text, { name: label });
    } catch (error) {
      writeTimingLog(services.logProcess, "error", `Timing parse failed: ${error.message}`,
        { ...context, code: "timing.parse-failed", error });
      throw error;
    }
    const { recordCount, scopeCount, diagnosticCount } = imported.summary;
    writeTimingLog(services.logProcess, diagnosticCount ? "warning" : "info",
      `Parsed ${recordCount} timing record(s) in ${scopeCount} scope(s) from ${label}`,
      { ...context, code: diagnosticCount ? "timing.parsed-with-warnings" : "timing.parsed", ...imported.summary });
    if (compareSide === "left" || compareSide === "right") {
      const sideTiming = compareSideActions?.setCompareSideTiming
        ? compareSideActions.setCompareSideTiming(compareSide, imported.timing, label, { append })
        : assignFallbackSideTiming(state, compareSide, imported.timing, label, append);
      const sideLabel = compareSide === "left" ? "A" : "B";
      const count = sideTiming?.instanceCount ?? imported.summary.instanceCount;
      if (state.compare.active) {
        return new Promise((resolve, reject) => services.renderCompareGraphs({
          signal,
          onCommitted: (graphs) => {
            services.renderStats();
            compareSideActions?.refreshCompareSelection?.();
            services.setStatus(`Loaded ${sideLabel} timing ${label}: ${count} instance(s)`);
            resolve(graphs);
          },
          onFailed: reject,
          onCancelled: () => reject(createStartupCancellationError("Timing render was cancelled"))
        }));
      }
      services.setStatus(`Loaded ${sideLabel} timing ${label}: ${count} instance(s)`);
      return Promise.resolve(null);
    }

    state.timing = append ? mergeImportedTiming(state.timing, imported.timing) : imported.timing;
    compareSideActions?.updateCompareSideTimingControls?.();
    resetTimingPresentation(state);
    if (state.compare.active) {
      return new Promise((resolve, reject) => services.renderCompareGraphs({
        signal,
        onCommitted: (graphs) => {
          services.renderStats();
          compareSideActions?.refreshCompareSelection?.();
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

  function loadDesign(source, label, restore = null, { signal, append = false, compareSide = null } = {}) {
    services.logProcess("info", "import", `Loading design ${label}`);
    const validRestoredFiles = Array.isArray(restore?.sourceFiles)
      ? restore.sourceFiles.filter((entry) => entry && typeof entry.text === "string")
      : [];
    const restoreMulti = validRestoredFiles.length > 1;
    const canAppend = Boolean(!restoreMulti && (append || compareSide) && state.design && state.currentSourceLabel !== "built-in sample");
    const existingFiles = state.sourceFiles?.length
      ? state.sourceFiles
      : (state.currentSource ? [{ name: state.currentSourceLabel || "Verilog", text: state.currentSource }] : []);
    const nextSourceFiles = restoreMulti
      ? validRestoredFiles.map((entry) => ({ name: entry.name || "Verilog", text: entry.text }))
      : canAppend
        ? [...existingFiles, { name: label, text: source }]
        : [{ name: label, text: source }];
    const effectiveLabel = nextSourceFiles.length > 1 ? formatMergedSourceLabel(nextSourceFiles) : label;
    const revision = (state.document?.sourceRevision || 0) + 1;

    let documentEnvelope;
    try {
      documentEnvelope = nextSourceFiles.length > 1
        ? mergeNetlistSources(nextSourceFiles, { documentId: "document:primary", sourceRevision: revision })
        : importDesignSource(source, { name: label, documentId: "document:primary", sourceRevision: revision });
    } catch (error) {
      services.logProcess("error", "parse", `Design parse failed: ${error.message}`, {
        operation: canAppend ? "import.merge-netlist" : "import.netlist",
        code: canAppend ? "netlist.merge-parse-failed" : "netlist.parse-failed",
        label, compareSide, append: canAppend, error
      });
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
        label: effectiveLabel, append: canAppend, compareSide,
        fileCount: nextSourceFiles.length, diagnostics: design.diagnostics?.length || 0
      });

      const prevCurrentSnapshot = snapshotModuleIdentity(state.currentModule);
      const prevLeftSnapshot = snapshotModuleIdentity(
        state.design?.modules.find((m) => m.name === state.compare.leftModuleName)
      );
      const prevRightSnapshot = snapshotModuleIdentity(
        state.design?.modules.find((m) => m.name === state.compare.rightModuleName)
      );
      const preservedTiming = canAppend ? state.timing : null;

      if (canAppend && (compareSide || state.compare.active)) {
        return applyCompareDesignMerge({
          design, documentEnvelope, nextSourceFiles, effectiveLabel, compareSide,
          prevCurrentSnapshot, prevLeftSnapshot, prevRightSnapshot, signal
        });
      }

      if (state.compare.active) services.exitCompareView({ deferSingleRender: true });
      if (state.document?.documentId) services.workspaceJobs.cancelDocument(state.document.documentId);
      state.document = services.documents.open(documentEnvelope);
      services.viewSessions.closeByDocument(documentEnvelope.documentId);
      state.design = design;
      state.currentSource = nextSourceFiles.length === 1 ? source : null;
      state.currentSourceLabel = effectiveLabel;
      state.sourceIdentity = createSourceIdentity(effectiveLabel, sourcePayloadForIdentity(nextSourceFiles, source));
      if ((restore?.showPath || restore?.comparePathView) && (restore.pathSourceUnverified || restore.sourceIdentity?.fingerprint !== state.sourceIdentity.fingerprint)) {
        services.logProcess("warning", "persistence", "Source changed; saved Show Path endpoints cleared", {
          operation: "show-path.restore", code: "show-path.source-mismatch", moduleName: restore.moduleName, documentId: state.document.documentId });
        restore = { ...restore, showPath: null, comparePathView: null, occurrenceContext: null };
      }
      const compareSync = restore?.compareSync ?? restore?.comparePathView?.compare ?? (canAppend ? state.compare : null);
      resetDesignWorkspace(state, () => services.singleViewSession.resetNavigation(), compareSync);
      state.sourceFiles = nextSourceFiles;
      services.compareViewSessions.resetState();
      state.currentModule = null;
      state.searchIndex = services.netlistFeature.buildSearchIndex(documentEnvelope);
      services.clearSearch();
      if (restore?.timing) {
        state.timing = restore.timing;
      } else if (preservedTiming) {
        state.timing = preservedTiming;
      } else if (label === "built-in sample" && !restore?.timingDisabled) {
        try {
          const imported = importTimingSource(sampleTiming, { name: "built-in sample timing" });
          state.timing = imported.timing;
        } catch (error) {
          services.logProcess("warning", "timing", "Built-in sample timing could not be loaded", { error });
          state.timing = null;
        }
      }
      compareSideActions?.updateCompareSideTimingControls?.();
      if (restore?.searchQuery) {
        state.searchQuery = restore.searchQuery;
        elements.searchInput.value = restore.searchQuery;
        services.handleSearchInput({ openResults: false });
      }
      services.renderModuleOptions();
      const firstModule = (canAppend && remapModule(design.modules, prevCurrentSnapshot))
        || state.design.modules.find((module) =>
          module.name === restore?.moduleName || module.displayName === restore?.moduleName)
        || state.design.modules[0];
      const readyMessage = state.timing
        ? `Loaded ${effectiveLabel}: ${state.design.modules.length} module(s), timing: ${state.timing.instanceCount} instance(s)`
        : `Loaded ${effectiveLabel}: ${state.design.modules.length} module(s)`;
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

  function applyCompareDesignMerge({
    design, documentEnvelope, nextSourceFiles, effectiveLabel, compareSide,
    prevCurrentSnapshot, prevLeftSnapshot, prevRightSnapshot, signal
  }) {
    if (state.document?.documentId) services.workspaceJobs.cancelDocument(state.document.documentId);
    state.document = services.documents.open(documentEnvelope);
    services.viewSessions.closeByDocument(documentEnvelope.documentId);
    state.design = design;
    state.sourceFiles = nextSourceFiles;
    state.currentSource = null;
    state.currentSourceLabel = effectiveLabel;
    state.sourceIdentity = createSourceIdentity(effectiveLabel, sourcePayloadForIdentity(nextSourceFiles, ""));
    state.searchIndex = services.netlistFeature.buildSearchIndex(documentEnvelope);
    services.clearSearch();
    const remappedCurrent = remapModule(design.modules, prevCurrentSnapshot) || design.modules[0];
    state.currentModule = remappedCurrent;
    services.renderModuleOptions();

    const latestSourceFile = design.modules[design.modules.length - 1]?.sourceFile || null;
    const addedModules = latestSourceFile
      ? design.modules.filter((m) => m.sourceFile === latestSourceFile)
      : [];
    let leftModule = remapModule(design.modules, prevLeftSnapshot);
    let rightModule = remapModule(design.modules, prevRightSnapshot);
    if (compareSide === "left") {
      leftModule = pickAddedCompareModule(addedModules, rightModule) || leftModule;
    } else if (compareSide === "right") {
      rightModule = pickAddedCompareModule(addedModules, leftModule) || rightModule;
    }
    const readyMessage = `Loaded ${effectiveLabel}: ${design.modules.length} module(s)`;

    if (compareSideActions?.applyMergedCompareModules) {
      return new Promise((resolve, reject) => compareSideActions.applyMergedCompareModules({
        leftModuleName: leftModule?.name || null,
        rightModuleName: rightModule?.name || null,
        signal,
        readyMessage,
        onCommitted: (graphs) => {
          services.renderStats();
          services.setStatus(readyMessage);
          resolve(graphs);
        },
        onFailed: reject,
        onCancelled: () => reject(createStartupCancellationError("Compare merge render was cancelled"))
      }));
    }
    if (leftModule) state.compare.leftModuleName = leftModule.name;
    if (rightModule) state.compare.rightModuleName = rightModule.name;
    services.renderStats();
    return new Promise((resolve, reject) => services.renderCompareGraphs({
      signal,
      onCommitted: (graphs) => {
        services.setStatus(readyMessage);
        resolve(graphs);
      },
      onFailed: reject,
      onCancelled: () => reject(createStartupCancellationError("Compare merge render was cancelled"))
    }));
  }

  return Object.freeze({ initializeApplication, createStartupHandlers, loadQuickInputText, loadTimingText, loadDesign });
}

function assignFallbackSideTiming(state, side, timing, label, append) {
  const prev = state.compare.sideTiming?.[side] || null;
  const prevLabel = state.compare.sideTimingLabels?.[side];
  const next = append && prev ? mergeImportedTiming(prev, timing) : timing;
  if (state.compare.sideTiming) state.compare.sideTiming[side] = next;
  if (state.compare.sideTimingLabels) {
    state.compare.sideTimingLabels[side] = append && prev && prevLabel ? `${prevLabel} + ${label}` : label;
  }
  return next;
}

function sourcePayloadForIdentity(sourceFiles, singleSource) {
  if (sourceFiles.length <= 1) return singleSource;
  return sourceFiles.map((entry) => `${entry.name}\u0000${entry.text}`).join("\u0001");
}

function snapshotModuleIdentity(module) {
  if (!module) return null;
  return {
    name: module.name,
    originalName: module.originalName || module.name,
    sourceFile: module.sourceFile || null
  };
}

function remapModule(modules, snapshot) {
  if (!snapshot) return null;
  const exact = modules.find((item) => item.name === snapshot.name);
  if (exact) return exact;
  if (snapshot.sourceFile) {
    const bySource = modules.find((item) =>
      item.sourceFile === snapshot.sourceFile
      && (item.originalName || item.name) === snapshot.originalName);
    if (bySource) return bySource;
  }
  return modules.find((item) => (item.originalName || item.name) === snapshot.originalName) || null;
}

function pickAddedCompareModule(addedModules, peerModule) {
  if (!Array.isArray(addedModules) || addedModules.length === 0) return null;
  if (addedModules.length === 1) return addedModules[0];
  if (peerModule) {
    const peerRaw = peerModule.originalName || peerModule.name;
    const sameRaw = addedModules.find((m) => (m.originalName || m.name) === peerRaw);
    if (sameRaw) return sameRaw;
    const paired = recommendModulePair([peerModule, ...addedModules], peerModule.name);
    if (paired && addedModules.includes(paired)) return paired;
  }
  const hierarchy = buildModuleHierarchy({ modules: addedModules });
  const rootName = hierarchy[0]?.moduleName;
  return addedModules.find((m) => m.name === rootName) || addedModules[0];
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
    "selectedNodeId", "singleWorkspaceIdentity", "sourceFiles", "sourceIdentity", "timing", "timingBadgeChoices", "timingBadgePositions",
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
