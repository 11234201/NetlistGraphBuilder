import { inspectGraphNet, inspectGraphNode } from "../analysis/graphInspector.js";
import { recommendModulePair } from "../analysis/moduleCompare.js";
import {
  compareLayoutGraphs,
  createLayoutGolden,
  getLayoutGoldenState
} from "../layout/layoutGolden.js";
import {
  DEFAULT_LAYOUT_POLICY,
  normalizeLayoutPolicy
} from "../layout/layoutPolicy.js";
import { getLayoutProvider, listLayoutProviders } from "../layout/layoutProvider.js";
import { createNetlistScene } from "../domains/netlist/netlist_scene.js";
import { cancelSchematicRender, renderSvgSceneIntoMount } from "../render/progressiveSvgRenderer.js";
import { renderSvgScene } from "../render/svg_scene_renderer.js";
import { beginWorkspaceRequest, captureWorkspaceRequest } from "./workspaceRequest.js";
import { createLayoutSpacingController } from "../ui/layout_spacing_controller.js";
import { createTimingDisplayController } from "../ui/timing_display_controller.js";
import { createQuickInputController, isEditableInputTarget } from "../ui/quick_input_controller.js";
import { createWheelGestureController } from "../ui/wheel_gesture_controller.js";
import { startCanvasPan } from "../ui/canvas_pan_controller.js";
import { startCanvasNodeDrag } from "../ui/canvas_node_drag_controller.js";
import { createStandaloneSvg } from "../render/svgExport.js";
import { createSearchControls } from "../ui/searchControls.js";
import { createDefaultDomainRegistry } from "../bootstrap/default_domains.js";
import { createModuleHierarchyController } from "../ui/module_hierarchy_controller.js";
import { createBrowserDownload, sanitizeDownloadFileName } from "../platform/browser_download.js";
import { importTimingSource } from "../application/timing_import.js";
import {
  parseCellConfig,
  serializeCellConfig,
} from "../infer/cellConfig.js";
import { loadStoredCellConfig, saveStoredCellConfig } from "../persistence/cell_config_storage.js";
import { createCellConfigUseCases } from "../application/cell_config_use_cases.js";
import { bindAdjustPanel, renderAdjustPanel } from "../ui/adjustPanel.js";
import {
  collectCellTypeSummary,
  createInferredCellDefinition,
  readCellDefinitionEditor,
  renderCellDefinitionEditor
} from "../ui/cellDefinitionPanel.js";
import {
  escapeAttr,
  escapeHtml,
  renderDefinitionRows as statsRows
} from "../ui/html.js";
import { renderObjectDetails } from "../ui/objectDetailsPanel.js";
import { startPointerSession } from "../ui/pointerSession.js";
import {
  clientPointToViewBox,
  formatViewportTransform,
  getAdaptiveMaxScale,
  getFocusedObjectTransform,
  getReadableObjectScale,
  getSteppedZoomedTransform,
  getZoomedTransform
} from "../ui/viewport.js";
import {
  bindTimingPanel,
  getTimingBadgeChoices,
  isTimingBadgePosition,
  renderTimingPanel,
  updateTimingBadgeChoices
} from "../ui/timingPanel.js";
import {
  createAppState,
  createEmptyGraphOverrides,
  normalizeFocusedRootNodeIds,
  restoreCompareWorkspace,
  restoreModuleWorkspace,
  resetDesignWorkspace,
  resetTimingPresentation,
  saveCompareWorkspace,
  saveModuleWorkspace,
  setFocusedRootNodeIds
} from "./appState.js";
import { sampleNetlist } from "./sampleNetlist.js";
import { createSessionSnapshot, loadSessionState, saveSessionState } from "./sessionState.js";
import { normalizeSingleViewMode } from "./singleViewMode.js";
import {
  addFocusedRootNodeId,
  normalizeFocusedRootNodeIds as normalizeFocusedSelectionRoots,
  resolveFocusedRootTarget,
  resolveFocusedRootState,
  resolveFocusedRootAction,
  toggleFocusedRootNodeId
} from "./focusedSelection.js";
import {
  buildCompareWorkspace,
  findCompareNode,
  getCompareNodeName
} from "./compareWorkspace.js";
import { buildModuleWorkspace } from "./moduleWorkspace.js";
import { applyWorkspaceOverrides } from "./layoutWorkspace.js";
import { importDesignSource } from "./designInput.js";
import { createLegacyViewCommandAdapter } from "./legacy_view_command_adapter.js";
import { createLegacyCompareSessionAdapter } from "./legacy_compare_session_adapter.js";
import {
  applyLayoutGoldenState,
  resolveLayoutGoldenModule
} from "./layoutGoldenImport.js";
import { findReferencedModule } from "./moduleNavigation.js";
import { resolveCellConfigRefreshView, shouldUseSearchFirst } from "./graphWorkspace.js";
import { createProcessLogController } from "../ui/process_log_controller.js";
import {
  closeAllDisclosures,
  closeDisclosuresOutside,
  closeOtherDisclosures
} from "../ui/disclosure.js";
import { executeStartupManifest, fetchStartupManifest } from "./startupController.js";
import {
  canStepModuleHistory,
  createModuleHistoryEntry,
  pushModuleHistory,
  replaceCurrentModuleHistory,
  stepModuleHistory
} from "./moduleHistory.js";

const state = createAppState(DEFAULT_LAYOUT_POLICY);
const browserDownload = createBrowserDownload();
const domainRegistry = createDefaultDomainRegistry();
const netlistFeature = domainRegistry.require("netlist");
const legacyViewCommands = createLegacyViewCommandAdapter({
  state,
  getDocumentId: () => state.document?.documentId || null
});
const legacyCompareSessions = createLegacyCompareSessionAdapter({
  state,
  getDocumentId: () => state.document?.documentId || null
});
state.cellConfig = loadStoredCellConfig();
const cellConfigUseCases = createCellConfigUseCases({ save: saveStoredCellConfig });
const SEARCH_FIRST_NODE_THRESHOLD = 500;
let sessionSaveTimer = null;
let focusedDepthChangeTimer = null;
let activeCellDefinition = null;

const elements = {
  fileInput: document.querySelector("#fileInput"),
  pasteNetlistButton: document.querySelector("#pasteNetlistButton"),
  pasteTimingButton: document.querySelector("#pasteTimingButton"),
  netlistTextDialog: document.querySelector("#netlistTextDialog"),
  netlistTextForm: document.querySelector("#netlistTextForm"),
  netlistTextInput: document.querySelector("#netlistTextInput"),
  netlistTextTitle: document.querySelector("#netlistTextTitle"),
  netlistTextDescription: document.querySelector("#netlistTextDescription"),
  closeNetlistTextButton: document.querySelector("#closeNetlistTextButton"),
  cancelNetlistTextButton: document.querySelector("#cancelNetlistTextButton"),
  dropOverlay: document.querySelector("#dropOverlay"),
  timingInput: document.querySelector("#timingInput"),
  goldenInput: document.querySelector("#goldenInput"),
  moduleSelect: document.querySelector("#moduleSelect"),
  moduleBackButton: document.querySelector("#moduleBackButton"),
  moduleForwardButton: document.querySelector("#moduleForwardButton"),
  layoutProviderSelect: document.querySelector("#layoutProviderSelect"),
  compareButton: document.querySelector("#compareButton"),
  comparePanel: document.querySelector("#comparePanel"),
  leftModuleSelect: document.querySelector("#leftModuleSelect"),
  rightModuleSelect: document.querySelector("#rightModuleSelect"),
  applyCompareButton: document.querySelector("#applyCompareButton"),
  exitCompareButton: document.querySelector("#exitCompareButton"),
  syncCompareInput: document.querySelector("#syncCompareInput"),
  compareLayoutSelect: document.querySelector("#compareLayoutSelect"),
  compareOutputSelect: document.querySelector("#compareOutputSelect"),
  moduleHierarchyTree: document.querySelector("#moduleHierarchyTree"),
  syncCompareFocusInput: document.querySelector("#syncCompareFocusInput"),
  searchInput: document.querySelector("#searchInput"),
  searchClearButton: document.querySelector("#searchClearButton"),
  searchResults: document.querySelector("#searchResults"),
  wholeViewButton: document.querySelector("#wholeViewButton"),
  focusedViewButton: document.querySelector("#focusedViewButton"),
  coneDepthInput: document.querySelector("#coneDepthInput"),
  faninDepthInput: document.querySelector("#faninDepthInput"),
  fanoutDepthInput: document.querySelector("#fanoutDepthInput"),
  showAliasesInput: document.querySelector("#showAliasesInput"),
  fanoutHubsInput: document.querySelector("#fanoutHubsInput"),
  collapseGroupsInput: document.querySelector("#collapseGroupsInput"),
  collapseAllButton: document.querySelector("#collapseAllButton"),
  setFocusedRootButton: document.querySelector("#setFocusedRootButton"),
  focusedRootCount: document.querySelector("#focusedRootCount"),
  focusedRootsList: document.querySelector("#focusedRootsList"),
  addFocusedRootButton: document.querySelector("#addFocusedRootButton"),
  removeFocusedRootButton: document.querySelector("#removeFocusedRootButton"),
  clearFocusedRootsButton: document.querySelector("#clearFocusedRootsButton"),
  focusSelectedButton: document.querySelector("#focusSelectedButton"),
  wireSpacingInput: document.querySelector("#wireSpacingInput"),
  wireSpacingNumberInput: document.querySelector("#wireSpacingNumberInput"),
  wireSpacingValue: document.querySelector("#wireSpacingValue"),
  cellSpacingInput: document.querySelector("#cellSpacingInput"),
  cellSpacingNumberInput: document.querySelector("#cellSpacingNumberInput"),
  cellSpacingValue: document.querySelector("#cellSpacingValue"),
  timingSnapshotSelect: document.querySelector("#timingSnapshotSelect"),
  timingMetricSelect: document.querySelector("#timingMetricSelect"),
  editCellDefinitionButton: document.querySelector("#editCellDefinitionButton"),
  cellConfigInput: document.querySelector("#cellConfigInput"),
  exportCellConfigButton: document.querySelector("#exportCellConfigButton"),
  resetCellConfigButton: document.querySelector("#resetCellConfigButton"),
  cellDefinitionDialog: document.querySelector("#cellDefinitionDialog"),
  cellDefinitionForm: document.querySelector("#cellDefinitionForm"),
  cellDefinitionBody: document.querySelector("#cellDefinitionBody"),
  closeCellDefinitionButton: document.querySelector("#closeCellDefinitionButton"),
  cancelCellDefinitionButton: document.querySelector("#cancelCellDefinitionButton"),
  deleteCellDefinitionButton: document.querySelector("#deleteCellDefinitionButton"),
  fitButton: document.querySelector("#fitButton"),
  exportSvgButton: document.querySelector("#exportSvgButton"),
  adjustLayoutButton: document.querySelector("#adjustLayoutButton"),
  saveGoldenButton: document.querySelector("#saveGoldenButton"),
  resetLayoutButton: document.querySelector("#resetLayoutButton"),
  workspace: document.querySelector(".workspace"),
  sidebarResizeHandle: document.querySelector("#sidebarResizeHandle"),
  canvas: document.querySelector("#canvas"),
  mount: document.querySelector("#schematicMount"),
  compareMount: document.querySelector("#compareMount"),
  leftMount: document.querySelector("#leftSchematicMount"),
  rightMount: document.querySelector("#rightSchematicMount"),
  stats: document.querySelector("#designStats"),
  details: document.querySelector("#selectionDetails"),
  diagnostics: document.querySelector("#diagnosticsList"),
  status: document.querySelector("#statusBar"),
  processLogDrawer: document.querySelector("#processLogDrawer"),
  toggleProcessLogButton: document.querySelector("#toggleProcessLogButton"),
  processLogCount: document.querySelector("#processLogCount"),
  processLogControls: document.querySelector("#processLogControls"),
  processLogLevelFilter: document.querySelector("#processLogLevelFilter"),
  processLogPhaseFilter: document.querySelector("#processLogPhaseFilter"),
  processLogAutoScroll: document.querySelector("#processLogAutoScroll"),
  copyProcessLogButton: document.querySelector("#copyProcessLogButton"),
  exportProcessLogButton: document.querySelector("#exportProcessLogButton"),
  clearProcessLogButton: document.querySelector("#clearProcessLogButton"),
  processLogList: document.querySelector("#processLogList")
};
const processLogController = createProcessLogController({
  elements: {
    toggleButton: elements.toggleProcessLogButton,
    count: elements.processLogCount,
    controls: elements.processLogControls,
    levelFilter: elements.processLogLevelFilter,
    phaseFilter: elements.processLogPhaseFilter,
    autoScroll: elements.processLogAutoScroll,
    copyButton: elements.copyProcessLogButton,
    exportButton: elements.exportProcessLogButton,
    clearButton: elements.clearProcessLogButton,
    list: elements.processLogList
  },
  setStatus,
  copyText: (text) => navigator.clipboard.writeText(text),
  downloadText: (text, fileName, type) => browserDownload.text(text, fileName, type)
});
const moduleHierarchyController = createModuleHierarchyController({
  container: elements.moduleHierarchyTree,
  getDesign: () => state.design,
  getCurrentModuleName: () => state.currentModule?.name || null,
  navigate: selectModule
});
const layoutSpacingController = createLayoutSpacingController({
  elements,
  getSpacing: () => state.layoutPolicy.spacing,
  onCommit: commitLayoutSpacing
});
const timingDisplayController = createTimingDisplayController({
  elements: {
    snapshotSelect: elements.timingSnapshotSelect,
    metricSelect: elements.timingMetricSelect
  },
  getPolicy: () => state.timingDisplayPolicy,
  onCommit: commitTimingDisplayPolicy
});
const wheelGestureController = createWheelGestureController({
  canvas: elements.canvas,
  apply: applyPendingWheelGesture,
  onSettled: persistSession
});
const toolbarMenus = [...document.querySelectorAll(".toolbar-menu")];

createQuickInputController({
  elements: {
    netlistInput: elements.fileInput,
    timingInput: elements.timingInput,
    goldenInput: elements.goldenInput,
    pasteNetlistButton: elements.pasteNetlistButton,
    pasteTimingButton: elements.pasteTimingButton,
    textDialog: elements.netlistTextDialog,
    textForm: elements.netlistTextForm,
    textInput: elements.netlistTextInput,
    textTitle: elements.netlistTextTitle,
    textDescription: elements.netlistTextDescription,
    closeTextButton: elements.closeNetlistTextButton,
    cancelTextButton: elements.cancelNetlistTextButton,
    dropOverlay: elements.dropOverlay,
    body: document.body
  },
  windowTarget: window,
  loadText: loadQuickInputText,
  setStatus
});
elements.moduleSelect.addEventListener("change", () => {
  selectModule(elements.moduleSelect.value);
});
elements.moduleBackButton.addEventListener("click", () => navigateModuleHistory(-1));
elements.moduleForwardButton.addEventListener("click", () => navigateModuleHistory(1));
elements.layoutProviderSelect.addEventListener("change", handleLayoutProviderChange);
elements.compareButton.addEventListener("click", () => {
  if (state.compare.active) exitCompareView();
  else enterCompareView();
});
elements.applyCompareButton.addEventListener("click", applyCompareSelection);
elements.exitCompareButton.addEventListener("click", exitCompareView);
elements.syncCompareInput.addEventListener("change", (event) => { state.compare.synchronized = event.target.checked; });
elements.syncCompareFocusInput.addEventListener("change", (event) => {
  state.compare.focusedRootsSynchronized = event.target.checked;
});
elements.compareLayoutSelect.addEventListener("change", (event) => {
  state.compare.layout = event.target.value === "horizontal" ? "horizontal" : "vertical";
  applyCompareLayout();
  fitToView();
});
elements.compareOutputSelect.addEventListener("change", (event) => {
  state.compare.outputName = event.target.value || null;
  if (state.compare.outputName) {
    state.compare.focusedRootNodeIds = { left: [], right: [] };
    state.compare.activeFocusedRootNodeId = { left: null, right: null };
  }
  elements.coneDepthInput.disabled = !state.compare.outputName;
  renderCompareGraphs();
  renderStats();
});
const { handleSearchInput, handleSearchKeydown, handleSearchResultClick, clearSearch } = createSearchControls({
  elements: {
    searchInput: elements.searchInput,
    searchResults: elements.searchResults,
    searchClearButton: elements.searchClearButton
  },
  getIndex: () => state.searchIndex,
  onActivate: activateSearchResult,
  onAdd: addSearchResultToFocus,
  onChange: (search) => { state.searchQuery = search.searchQuery; }
});
elements.searchInput.addEventListener("input", handleSearchInput);
elements.searchInput.addEventListener("keydown", handleSearchKeydown);
elements.searchInput.addEventListener("focus", handleSearchInput);
elements.searchClearButton.addEventListener("click", clearSearch);
elements.searchResults.addEventListener("click", handleSearchResultClick);
elements.details.addEventListener("click", handleSelectionNavigationClick);
elements.wholeViewButton.addEventListener("click", () => setViewMode("whole"));
elements.focusedViewButton.addEventListener("click", () => setViewMode("focused"));
elements.coneDepthInput.addEventListener("change", handleConeDepthChange);
elements.faninDepthInput.addEventListener("input", scheduleFocusedDepthChange);
elements.fanoutDepthInput.addEventListener("input", scheduleFocusedDepthChange);
elements.showAliasesInput.addEventListener("change", handleAliasVisibilityChange);
elements.fanoutHubsInput.addEventListener("change", handleGraphSimplificationChange);
elements.collapseGroupsInput.addEventListener("change", handleGraphSimplificationChange);
elements.collapseAllButton.addEventListener("click", () => {
  state.expandedGroupIds.clear();
  rerenderActiveGraph();
});
elements.setFocusedRootButton.addEventListener("click", setSelectedAsFocusedRoot);
elements.addFocusedRootButton.addEventListener("click", addSelectedAsFocusedRoot);
elements.removeFocusedRootButton.addEventListener("click", removeSelectedFromFocusedRoots);
elements.clearFocusedRootsButton.addEventListener("click", clearFocusedRoots);
elements.focusedRootsList.addEventListener("click", handleFocusedRootListClick);
elements.focusSelectedButton.addEventListener("click", focusSelectedCell);
elements.editCellDefinitionButton.addEventListener("click", openSelectedCellDefinition);
elements.cellConfigInput.addEventListener("change", handleCellConfigImport);
elements.exportCellConfigButton.addEventListener("click", exportCellConfig);
elements.resetCellConfigButton.addEventListener("click", resetAllCellConfig);
elements.cellDefinitionForm.addEventListener("submit", saveActiveCellDefinition);
elements.closeCellDefinitionButton.addEventListener("click", closeCellDefinitionDialog);
elements.cancelCellDefinitionButton.addEventListener("click", closeCellDefinitionDialog);
elements.deleteCellDefinitionButton.addEventListener("click", deleteActiveCellDefinition);
elements.fitButton.addEventListener("click", fitToView);
elements.exportSvgButton.addEventListener("click", exportCurrentSvg);
elements.adjustLayoutButton.addEventListener("click", toggleCalibrationMode);
elements.saveGoldenButton.addEventListener("click", saveLayoutGolden);
elements.resetLayoutButton.addEventListener("click", resetLayoutOverrides);
for (const menu of toolbarMenus) {
  menu.addEventListener("toggle", () => closeOtherDisclosures(toolbarMenus, menu));
  menu.addEventListener("click", (event) => {
    if (event.target.closest(".menu-action")) menu.open = false;
  });
}
document.addEventListener("pointerdown", (event) => closeDisclosuresOutside(toolbarMenus, event.target));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeAllDisclosures(toolbarMenus);
});
elements.sidebarResizeHandle.addEventListener("pointerdown", startSidebarResize);
elements.sidebarResizeHandle.addEventListener("keydown", handleSidebarResizeKeydown);
elements.canvas.addEventListener("wheel", handleWheel, { passive: false });
elements.canvas.addEventListener("pointerdown", handlePointerDown);
elements.canvas.addEventListener("dblclick", handleCanvasDoubleClick);
window.addEventListener("keydown", handleModuleHistoryShortcut);
window.addEventListener("keydown", handleFocusSelectedShortcut);
window.addEventListener("beforeunload", () => {
  if (state.currentSource) saveSessionState(createSessionSnapshot(state));
});

const restoredSession = loadSessionState();
applySessionPreferences(restoredSession);
renderLayoutProviderOptions();
initializeApplication(restoredSession);
updateCalibrationControls();

async function initializeApplication(session) {
  try {
    const manifest = await fetchStartupManifest(globalThis.location?.search || "");
    if (!manifest) {
      loadDesign(session?.source || sampleNetlist, session?.sourceLabel || "built-in sample", session);
      return;
    }
    logProcess("info", "launcher", "Applying EDA startup manifest");
    await executeStartupManifest(manifest, createStartupHandlers());
  } catch (error) {
    logProcess("error", "launcher", `Startup failed: ${error.message}`);
    if (!state.currentModule) loadDesign(sampleNetlist, "built-in sample");
  }
}

function createStartupHandlers() {
  return {
    configureTarget(target) {
      state.layoutProviderId = "simple-layered";
      elements.layoutProviderSelect.value = state.layoutProviderId;
      if (target.faninDepth !== undefined) state.faninDepth = target.faninDepth;
      if (target.fanoutDepth !== undefined) state.fanoutDepth = target.fanoutDepth;
      elements.faninDepthInput.value = String(state.faninDepth);
      elements.fanoutDepthInput.value = String(state.fanoutDepth);
    },
    loadCellConfig(input) {
      state.cellConfig = parseCellConfig(input.text);
      logProcess("info", "launcher", `Applied Cell Config ${input.name}`, {
        definitionCount: Object.keys(state.cellConfig.cells).length
      });
    },
    loadNetlist(input, target) {
      return new Promise((resolve, reject) => {
        try {
          loadDesign(input.text, input.name, { moduleName: target.module, onRendered: resolve });
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
      return new Promise((resolve) => loadDesign(sampleNetlist, "built-in sample", { onRendered: resolve }));
    },
    selectModule: selectStartupModule,
    focusCell: focusStartupCell,
    focusCells: focusStartupCells,
    ready(manifest) {
      const detail = {
        module: state.currentModule?.name || null,
        focus: manifest.target.focus || null,
        faninDepth: state.faninDepth,
        fanoutDepth: state.fanoutDepth
      };
      globalThis.__NGB_STARTUP_READY__ = detail;
      globalThis.dispatchEvent?.(new CustomEvent("ngb-startup-ready", { detail }));
      logProcess("info", "launcher", `EDA startup ready: ${detail.module}`, detail);
    }
  };
}

function startSidebarResize(event) {
  if (event.button !== 0) {
    return;
  }
  event.preventDefault();
  startPointerSession({
    target: elements.sidebarResizeHandle,
    pointerId: event.pointerId,
    classTarget: elements.workspace,
    className: "is-resizing-sidebar",
    onMove: (moveEvent) => setSidebarWidth(
      moveEvent.clientX - elements.workspace.getBoundingClientRect().left
    )
  });
}

function handleSidebarResizeKeydown(event) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
    return;
  }
  event.preventDefault();
  const currentWidth = Number.parseFloat(getComputedStyle(elements.workspace).getPropertyValue("--sidebar-width")) || 300;
  setSidebarWidth(currentWidth + (event.key === "ArrowRight" ? 16 : -16));
}

function setSidebarWidth(width) {
  const maxWidth = Math.max(320, Math.min(640, elements.workspace.clientWidth - 320));
  const nextWidth = clamp(Math.round(width), 240, maxWidth);
  elements.workspace.style.setProperty("--sidebar-width", `${nextWidth}px`);
  elements.sidebarResizeHandle.setAttribute("aria-valuenow", String(nextWidth));
}

function loadQuickInputText(text, options = {}) {
  const kind = options.kind;
  const label = options.label || options.name || "quick input";
  if (kind === "netlist") {
    loadDesign(text, label);
    return kind;
  }
  if (kind === "golden") {
    loadLayoutGolden(getLayoutGoldenState(text), label);
    return kind;
  }

  loadTimingText(text, label);
  return kind;
}

function loadTimingText(text, label) {
  logProcess("info", "timing", `Parsing timing ${label}`);
  let imported;
  try {
    imported = importTimingSource(text, { name: label });
  } catch (error) {
    logProcess("error", "timing", `Timing parse failed: ${error.message}`, { label });
    throw error;
  }
  state.timing = imported.timing;
  logProcess("info", "timing", `Loaded ${imported.summary.recordCount} timing scope(s)`, {
    label,
    format: imported.summary.format,
    diagnostics: imported.summary.diagnosticCount
  });
  resetTimingPresentation(state);
  if (state.compare.active) {
    renderCompareGraphs();
    renderStats();
    setStatus(`Loaded timing ${label}: ${state.timing.instanceCount} instance(s)`);
    return;
  }
  if (state.currentModule) {
    rerenderPreservingView(state.selectedNodeId);
    renderStats();
  }
  setStatus(`Loaded timing ${label}: ${state.timing.instanceCount} instance(s)`);
}

function loadDesign(source, label, restore = null) {
  logProcess("info", "import", `Loading design ${label}`);
  let documentEnvelope;
  try {
    documentEnvelope = importDesignSource(source, {
      name: label,
      documentId: "document:primary",
      sourceRevision: (state.document?.sourceRevision || 0) + 1
    });
  } catch (error) {
    logProcess("error", "parse", `Design parse failed: ${error.message}`, { label });
    setStatus(`Parse failed: ${error.message}`);
    throw error;
  }

  try {
    const design = documentEnvelope.model;
    logProcess("info", "parse", `Parsed ${design.modules.length} module(s)`, {
      label,
      diagnostics: design.diagnostics?.length || 0
    });
    state.document = documentEnvelope;
    state.design = design;
    state.currentSource = source;
    state.currentSourceLabel = label;
    resetDesignWorkspace(state);
    state.currentModule = null;
    state.searchIndex = netlistFeature.buildSearchIndex(documentEnvelope);
    clearSearch();
    if (restore?.searchQuery) {
      state.searchQuery = restore.searchQuery;
      elements.searchInput.value = restore.searchQuery;
      handleSearchInput();
    }
    renderModuleOptions();
    const firstModule = state.design.modules.find((module) => module.name === restore?.moduleName)
      || state.design.modules[0];
    const readyMessage = `Loaded ${label}: ${state.design.modules.length} module(s)`;
    selectModule(firstModule.name, { readyMessage, onRendered: restore?.onRendered });
    const restoredFocusedRoots = normalizeFocusedRootNodeIds(
      restore?.focusedRootNodeIds,
      restore?.coneRootNodeId
    );
    if (restore?.viewMode && restore.viewMode !== "whole" && restoredFocusedRoots.length > 0) {
      state.viewMode = normalizeSingleViewMode(restore.viewMode);
      setFocusedRootNodeIds(state, restoredFocusedRoots, restore.activeFocusedRootNodeId);
      renderCurrentModuleGraph({ readyMessage });
    }
    if (restore?.transform) state.transform = { ...restore.transform };
    setStatus(readyMessage);
  } catch (error) {
    setStatus(`Load failed: ${error.message}`);
    throw error;
  }
}

function renderModuleOptions() {
  elements.moduleSelect.innerHTML = "";
  for (const module of state.design.modules) {
    const option = document.createElement("option");
    option.value = module.name;
    option.textContent = module.displayName;
    elements.moduleSelect.append(option);
  }
  renderCompareModuleOptions();
  renderModuleHierarchy();
}

function renderModuleHierarchy() {
  moduleHierarchyController.render();
}

function renderCompareModuleOptions() {
  for (const select of [elements.leftModuleSelect, elements.rightModuleSelect]) {
    select.innerHTML = "";
    for (const module of state.design.modules) {
      const option = document.createElement("option");
      option.value = module.name;
      option.textContent = module.displayName;
      select.append(option);
    }
  }
}

function enterCompareView() {
  const left = state.currentModule || state.design?.modules[0];
  const right = recommendModulePair(state.design?.modules || [], left?.name)
    || state.design?.modules.find((module) => module !== left);
  if (!left || !right) {
    setStatus("Compare requires at least two modules");
    return;
  }
  elements.leftModuleSelect.value = left.name;
  elements.rightModuleSelect.value = right.name;
  applyCompareSelection();
}

function applyCompareSelection() {
  const left = state.design.modules.find((module) => module.name === elements.leftModuleSelect.value);
  const right = state.design.modules.find((module) => module.name === elements.rightModuleSelect.value);
  if (!left || !right || left === right) {
    setStatus("Choose two different modules to compare");
    return;
  }
  const pairChanged = state.compare.leftModuleName !== left.name || state.compare.rightModuleName !== right.name;
  if (state.compare.leftModuleName && state.compare.rightModuleName) {
    saveCompareWorkspace(state);
  }
  state.compare.active = true;
  if (pairChanged) {
    restoreCompareWorkspace(state, left.name, right.name);
  }
  state.compare.leftModuleName = left.name;
  state.compare.rightModuleName = right.name;
  state.compare.outputName = null;
  state.compare.selectedName = null;
  state.compare.selectedSide = null;
  updateFocusSelectedControl();
  state.compare.transforms.left = { x: 0, y: 0, scale: 1 };
  state.compare.transforms.right = { x: 0, y: 0, scale: 1 };
  elements.comparePanel.hidden = false;
  elements.mount.hidden = true;
  elements.compareMount.hidden = false;
  elements.compareButton.classList.add("is-active");
  elements.compareButton.textContent = "Single";
  elements.compareButton.title = "退出双 module 对比视图";
  elements.compareButton.setAttribute("aria-pressed", "true");
  elements.compareLayoutSelect.value = state.compare.layout;
  elements.syncCompareFocusInput.checked = state.compare.focusedRootsSynchronized !== false;
  applyCompareLayout();
  elements.coneDepthInput.disabled = true;
  renderCompareGraphs();
  renderStats();
  renderSelection(null);
  updateCalibrationControls();
  updateModuleHistoryControls();
  setStatus(`Comparing ${left.displayName} and ${right.displayName}`);
}

function exitCompareView() {
  saveCompareWorkspace(state);
  state.compare.active = false;
  updateFocusSelectedControl();
  elements.comparePanel.hidden = true;
  elements.compareMount.hidden = true;
  elements.mount.hidden = false;
  elements.compareButton.classList.remove("is-active");
  elements.compareButton.textContent = "Compare";
  elements.compareButton.title = "进入双 module 对比视图";
  elements.compareButton.setAttribute("aria-pressed", "false");
  updateViewControls();
  renderStats();
  updateCalibrationControls();
  updateModuleHistoryControls();
  applyTransform();
  setStatus(`Single module view: ${state.currentModule?.displayName || "-"}`);
}

function applyCompareLayout() {
  elements.compareMount.classList.toggle("is-horizontal", state.compare.layout === "horizontal");
  elements.compareMount.classList.toggle("is-vertical", state.compare.layout !== "horizontal");
}

function renderCompareGraphs() {
  const leftModule = getCompareModule("left");
  const rightModule = getCompareModule("right");
  if (!leftModule || !rightModule) return;
  const request = beginWorkspaceRequest(state);
  const requestId = request.id;
  logProcess("debug", "graph", `Building Compare workspace: ${leftModule.displayName} / ${rightModule.displayName}`, {
    provider: getCurrentLayoutProvider().id
  });
  const workspace = buildCompareWorkspace({
    leftModule,
    rightModule,
    layoutProvider: getCurrentLayoutProvider(),
    layoutPolicy: state.layoutPolicy,
    outputName: state.compare.outputName,
    coneDepth: state.coneDepth,
    faninDepth: state.faninDepth,
    fanoutDepth: state.fanoutDepth,
    focusedRootNodeIds: state.compare.focusedRootNodeIds,
    activeFocusedRootNodeId: state.compare.activeFocusedRootNodeId,
    showAliases: state.showAliases,
    timing: state.timing,
    timingDisplayPolicy: state.timingDisplayPolicy,
    timingBadgeChoices: state.compare.timingBadgeChoices,
    timingBadgePositions: state.compare.timingBadgePositions,
    graphOverrides: state.compare.graphOverrides,
    cellConfig: state.cellConfig,
    nodePositions: state.compare.nodePositions,
    nodeSizes: state.compare.nodeSizes,
    useFanoutHubs: state.useFanoutHubs,
    collapseLargeGroups: state.collapseLargeGroups,
    expandedGroupIds: state.expandedGroupIds,
    moduleLibrary: state.design.modules
  });
  if (isPromise(workspace)) {
    logProcess("info", "layout", `Compare layout started (${getCurrentLayoutProvider().label})`, { requestId });
    setStatus(`Layout (${getCurrentLayoutProvider().label})…`);
    workspace.then(request.guard((result) => {
      commitCompareWorkspace(result, leftModule, rightModule);
    })).catch(request.guard(handleLayoutFailure));
    return;
  }
  commitCompareWorkspace(workspace, leftModule, rightModule);
}

function commitCompareWorkspace(workspace, leftModule, rightModule) {
  state.compare.fullGraphs = workspace.fullGraphs;
  state.compare.autoGraphs = workspace.autoGraphs;
  state.compare.graphs = workspace.graphs;
  state.compare.scenes = workspace.scenes;
  state.compare.analysis = workspace.analysis;
  logProcess("info", "layout", `Compare layout completed: ${workspace.graphs.left.nodes.length} / ${workspace.graphs.right.nodes.length} node(s)`, {
    leftModule: leftModule.name,
    rightModule: rightModule.name
  });
  elements.compareMount.querySelector('[data-compare-side="left"] > header').textContent = leftModule.displayName;
  elements.compareMount.querySelector('[data-compare-side="right"] > header').textContent = rightModule.displayName;
  renderCompareOutputOptions(leftModule, rightModule);
  Promise.all([
    renderGraphMount(elements.leftMount, state.compare.graphs.left, { scene: state.compare.scenes.left }),
    renderGraphMount(elements.rightMount, state.compare.graphs.right, { scene: state.compare.scenes.right })
  ]).then((results) => {
    if (results.some((result) => result?.cancelled)) return;
    applyCompareHighlights();
    applyCompareTransforms();
    logProcess("info", "render", "Compare render completed", {
      leftNodes: state.compare.graphs.left.nodes.length,
      rightNodes: state.compare.graphs.right.nodes.length
    });
    setStatus(`Compare ready (${getCurrentLayoutProvider().label})`);
  });
}

function renderCompareOutputOptions(left, right) {
  const selected = state.compare.outputName || "";
  const rightOutputs = new Set(right.ports.filter((port) => port.direction === "output").map((port) => port.name));
  const outputs = left.ports.filter((port) => port.direction === "output" && rightOutputs.has(port.name));
  elements.compareOutputSelect.innerHTML = `<option value="">Whole module</option>${outputs.map((port) =>
    `<option value="${escapeAttr(port.name)}">${escapeHtml(port.displayName)}</option>`).join("")}`;
  elements.compareOutputSelect.value = selected;
}

function getCompareModule(side) {
  return state.design?.modules.find((module) => module.name === state.compare[`${side}ModuleName`]);
}

function selectModule(moduleName, options = {}) {
  const module = state.design.modules.find((item) => item.name === moduleName);
  if (!module) {
    return;
  }
  const historyMode = options.historyMode || "push";
  const historyEntry = options.historyEntry || null;
  const switchingModule = state.currentModule?.name !== module.name;
  if (state.currentModule && switchingModule) {
    if (historyMode === "push") {
      state.moduleHistory = replaceCurrentModuleHistory(state.moduleHistory, createModuleHistoryEntry(state));
    }
    saveModuleWorkspace(state, state.currentModule.name);
  }
  state.currentModule = module;
  if (switchingModule) logProcess("info", "navigation", `Opened module ${module.displayName}`, { moduleName: module.name });
  elements.moduleSelect.value = module.name;
  renderModuleHierarchy();
  const restoredWorkspace = switchingModule && restoreModuleWorkspace(state, module.name);
  if (historyEntry) {
    applyModuleHistoryEntry(historyEntry);
  } else if (switchingModule && !restoredWorkspace && shouldUseSearchFirst(module, SEARCH_FIRST_NODE_THRESHOLD)) {
    state.viewMode = "search-first";
    setFocusedRootNodeIds(state, []);
  }
  if (!historyEntry) {
    state.transform = { x: 0, y: 0, scale: 1 };
    state.selectedNodeId = null;
    state.selectedNet = null;
  }
  const requestedOnRendered = options.onRendered;
  renderCurrentModuleGraph({
    ...options,
    onRendered: (graph) => {
      if (historyEntry) restoreModuleHistorySelection(historyEntry, graph);
      requestedOnRendered?.(graph);
    }
  });
  if (historyMode === "push" && (switchingModule || state.moduleHistory.index < 0)) {
    state.moduleHistory = pushModuleHistory(state.moduleHistory, createModuleHistoryEntry(state));
  }
  renderStats();
  renderDiagnostics();
  renderSelection(null);
  updateViewControls();
  applyTransform();
}

function navigateModuleHistory(delta) {
  if (state.compare.active || !state.currentModule) return;
  state.moduleHistory = replaceCurrentModuleHistory(state.moduleHistory, createModuleHistoryEntry(state));
  const validNames = state.design.modules.map((module) => module.name);
  const result = stepModuleHistory(state.moduleHistory, delta, validNames);
  if (!result.entry) {
    updateModuleHistoryControls();
    return;
  }
  state.moduleHistory = result.history;
  selectModule(result.entry.moduleName, {
    historyMode: "restore",
    historyEntry: result.entry,
    readyMessage: `Restored ${result.entry.moduleName} from module history`
  });
}

function applyModuleHistoryEntry(entry) {
  state.viewMode = normalizeSingleViewMode(entry.viewMode);
  setFocusedRootNodeIds(state, normalizeFocusedRootNodeIds(
    entry.focusedRootNodeIds,
    entry.coneRootNodeId
  ), entry.activeFocusedRootNodeId);
  state.coneDepth = entry.coneDepth;
  state.faninDepth = entry.faninDepth;
  state.fanoutDepth = entry.fanoutDepth;
  state.selectedNodeId = entry.selectedNodeId || null;
  state.selectedNet = entry.selectedNet || null;
  state.transform = { ...entry.transform };
}

function restoreModuleHistorySelection(entry, graph) {
  state.transform = { ...entry.transform };
  if (entry.selectedNet && graph.edges.some((edge) => edge.net === entry.selectedNet)) {
    setSelectedNet(entry.selectedNet);
  } else if (entry.selectedNodeId && graph.nodes.some((node) => node.id === entry.selectedNodeId)) {
    setSelectedNode(entry.selectedNodeId);
  } else {
    setSelectedNode(null);
  }
  applyTransform();
  updateModuleHistoryControls();
}

function handleModuleHistoryShortcut(event) {
  if (!event.altKey || event.ctrlKey || event.metaKey || isEditableInputTarget(event.target)) return;
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  navigateModuleHistory(event.key === "ArrowLeft" ? -1 : 1);
}

function updateModuleHistoryControls() {
  const validNames = state.design?.modules.map((module) => module.name) || [];
  elements.moduleBackButton.disabled = state.compare.active || !canStepModuleHistory(state.moduleHistory, -1, validNames);
  elements.moduleForwardButton.disabled = state.compare.active || !canStepModuleHistory(state.moduleHistory, 1, validNames);
}

function renderCurrentModuleGraph(options = {}) {
  const request = beginWorkspaceRequest(state);
  const requestId = request.id;
  const layoutProvider = getCurrentLayoutProvider();
  logProcess("debug", "graph", `Building ${state.currentModule?.displayName || "module"} graph`, {
    viewMode: state.viewMode,
    provider: layoutProvider.id
  });
  const workspace = buildModuleWorkspace({
    module: state.currentModule,
    moduleLibrary: state.design.modules,
    graphOverrides: state.graphOverrides,
    cellConfig: state.cellConfig,
    timing: state.timing,
    timingDisplayPolicy: state.timingDisplayPolicy,
    timingBadgeChoices: state.timingBadgeChoices,
    timingBadgePositions: state.timingBadgePositions,
    showAliases: state.showAliases,
    viewMode: state.viewMode,
    focusedRootNodeIds: state.focusedRootNodeIds,
    activeFocusedRootNodeId: state.activeFocusedRootNodeId,
    coneRootNodeId: state.coneRootNodeId,
    coneDepth: state.coneDepth,
    faninDepth: state.faninDepth,
    fanoutDepth: state.fanoutDepth,
    useFanoutHubs: state.useFanoutHubs,
    collapseLargeGroups: state.collapseLargeGroups,
    expandedGroupIds: state.expandedGroupIds,
    layoutProvider,
    layoutPolicy: state.layoutPolicy,
    nodePositions: state.nodePositions,
    nodeSizes: state.nodeSizes
  });
  if (isPromise(workspace)) {
    logProcess("info", "layout", `Layout started (${layoutProvider.label})`, { requestId });
    setStatus(`Layout (${layoutProvider.label})…`);
    workspace.then(request.guard((result) => {
      commitCurrentWorkspace(result, options);
    })).catch(request.guard(handleLayoutFailure));
    return;
  }
  commitCurrentWorkspace(workspace, options);
}

function commitCurrentWorkspace(workspace, options = {}) {
  state.fullGraph = workspace.fullGraph;
  state.scene = workspace.scene;
  logProcess("info", "layout", `Layout completed: ${workspace.graph.nodes.length} node(s), ${workspace.graph.edges.length} edge(s)`, {
    fullNodes: workspace.fullGraph.nodes.length,
    viewMode: workspace.graph.view?.mode || state.viewMode
  });
  commitCurrentGraph(workspace.autoGraph, workspace.graph, { ...options, scene: workspace.scene });
}

function commitCurrentGraph(autoGraph, graph, options = {}) {
  const { readyMessage = null, onRendered = null, scene = null } = options;
  state.autoGraph = autoGraph;
  state.graph = graph;
  renderGraphMount(elements.mount, graph, { scene }).then((result) => {
    if (result?.cancelled) return;
    applyTransform();
    setStatus(readyMessage || `Ready (${getCurrentLayoutProvider().label})`);
    onRendered?.(graph);
  });
  updateCalibrationControls();
  updateViewControls();
  persistSession();
}

function renderGraphMount(mount, graph, renderOptions = {}) {
  const request = captureWorkspaceRequest(state);
  if (graph?.view?.mode === "search-first") {
    cancelSchematicRender(mount);
    mount.innerHTML = `<div class="search-first-empty"><strong>Search-first mode</strong><span>${Number(graph.view.totalNodes) || 0} nodes are indexed. Search for a cell to open its focused neighborhood, or choose Whole for an explicit overview.</span></div>`;
    return Promise.resolve().then(() => ({ cancelled: !request.isCurrent() }));
  }
  if (!renderOptions.scene) {
    return Promise.reject(new Error("Graph mount requires a prepared scene"));
  }
  return renderSvgSceneIntoMount(mount, renderOptions.scene, {
    ...renderOptions,
    isCurrent: request.isCurrent,
    onProgress: (progress) => {
      if (!request.isCurrent()) return;
      const { phase, rendered, total } = progress;
      if (phase === "render") {
        setStatus(`Rendering ${rendered}/${total}…`);
        logProcess("debug", "render", `Rendering ${rendered}/${total}`, { rendered, total }, { progressKey: "svg-batch" });
      }
      renderOptions.onProgress?.(progress);
    }
  }).then((result) => request.isCurrent() ? result : { ...result, cancelled: true });
}

function renderLayoutProviderOptions() {
  elements.layoutProviderSelect.innerHTML = listLayoutProviders()
    .map((provider) => `<option value="${escapeAttr(provider.id)}">${escapeHtml(provider.label)}</option>`)
    .join("");
  elements.layoutProviderSelect.value = state.layoutProviderId;
}

function handleLayoutProviderChange(event) {
  state.layoutProviderId = event.target.value;
  state.transform = { x: 0, y: 0, scale: 1 };
  if (state.layoutProviderId === "elk-layered") {
    setStatus("ELK Layered is experimental; Simple Layered is recommended for schematic editing");
  }
  if (state.compare.active) renderCompareGraphs();
  else renderCurrentModuleGraph();
  persistSession();
}

function handleLayoutFailure(error) {
  logProcess("error", "layout", `Layout failed; falling back to Simple Layered: ${error.message}`);
  state.layoutProviderId = "simple-layered";
  elements.layoutProviderSelect.value = state.layoutProviderId;
  setStatus(`Layout failed; using Simple Layered: ${error.message}`);
  if (state.compare.active) renderCompareGraphs();
  else renderCurrentModuleGraph();
}

function isPromise(value) {
  return Boolean(value && typeof value.then === "function");
}

function setViewMode(mode) {
  mode = normalizeSingleViewMode(mode);
  if (state.compare.active) {
    setCompareViewMode(mode);
    return;
  }
  if (mode !== "whole" && mode !== "search-first") {
    const existingRootNodeIds = normalizeFocusedRootNodeIds(
      state.focusedRootNodeIds,
      state.coneRootNodeId
    );
    const rootNodeIds = existingRootNodeIds.length > 0
      ? existingRootNodeIds
      : state.selectedNodeId ? [state.selectedNodeId] : [];
    if (rootNodeIds.length === 0) {
      setStatus("Select a cell before opening Focused view");
      return;
    }
    setFocusedRootNodeIds(state, rootNodeIds);
  }
  state.viewMode = mode;
  renderCurrentModuleGraph();
  state.transform = { x: 0, y: 0, scale: 1 };
  if (mode === "focused" && !state.selectedNodeId && state.coneRootNodeId) {
    setSelectedNode(state.coneRootNodeId);
  }
  applyTransform();
  const message = mode === "whole"
    ? "Whole module overview"
    : mode === "focused"
      ? `Focused neighborhood: fanin ${state.faninDepth}, fanout ${state.fanoutDepth}`
      : "Search-first mode";
  setStatus(message);
}

function setCompareViewMode(mode) {
  const context = getFocusedRootContext();
  if (mode === "focused") {
    if (context.roots.length === 0) {
      const selected = findCompareNode(context.fullGraph, "cell", state.compare.selectedName);
      if (!selected) {
        setStatus("Select a compare cell before opening Focused view");
        return;
      }
      setCompareFocusedRootNodeIds(context.side, [selected.id], selected.id);
    }
    state.compare.transforms[context.side] = { x: 0, y: 0, scale: 1 };
    updateViewControls();
    renderCompareGraphs();
    setStatus(`Compare ${context.side} Focused: fanin ${state.faninDepth}, fanout ${state.fanoutDepth}`);
    return;
  }
  if (mode === "whole") {
    for (const side of ["left", "right"]) {
      setCompareFocusedRootNodeIds(side, []);
      state.compare.transforms[side] = { x: 0, y: 0, scale: 1 };
    }
    state.compare.outputName = null;
    updateViewControls();
    renderCompareGraphs();
    setStatus("Whole compare modules");
  }
}

function handleConeDepthChange(event) {
  state.coneDepth = clamp(Math.floor(Number(event.target.value) || 1), 1, 99);
  elements.coneDepthInput.value = String(state.coneDepth);
  if (state.compare.active && state.compare.outputName) {
    renderCompareGraphs();
    renderStats();
    setStatus(`Compare fanin cone depth ${state.coneDepth}`);
    return;
  }
  if (state.viewMode !== "whole") {
    setViewMode(state.viewMode);
  }
}

function handleFocusedDepthChange() {
  state.faninDepth = clamp(Math.floor(Number(elements.faninDepthInput.value) || 0), 0, 99);
  state.fanoutDepth = clamp(Math.floor(Number(elements.fanoutDepthInput.value) || 0), 0, 99);
  elements.faninDepthInput.value = String(state.faninDepth);
  elements.fanoutDepthInput.value = String(state.fanoutDepth);
  if (state.compare.active) {
    if (state.compare.focusedRootNodeIds.left.length > 0 || state.compare.focusedRootNodeIds.right.length > 0) {
      renderCompareGraphs();
      renderStats();
    }
  } else if (state.viewMode === "focused") setViewMode("focused");
  else persistSession();
}

function scheduleFocusedDepthChange() {
  clearTimeout(focusedDepthChangeTimer);
  focusedDepthChangeTimer = setTimeout(handleFocusedDepthChange, 120);
}

function handleAliasVisibilityChange(event) {
  const selectedNode = state.graph?.nodes.find((node) => node.id === state.selectedNodeId);
  state.showAliases = event.target.checked;
  if (state.compare.active) {
    renderCompareGraphs();
    renderStats();
    setStatus(state.showAliases ? "Compare aliases shown" : "Compare aliases collapsed");
    return;
  }
  const selectedNodeId = state.selectedNodeId;
  if (!state.showAliases && selectedNode?.kind === "assign") {
    state.viewMode = "whole";
    setFocusedRootNodeIds(state, []);
  }
  renderCurrentModuleGraph();
  state.selectedNodeId = null;
  setSelectedNode(state.graph.nodes.some((node) => node.id === selectedNodeId) ? selectedNodeId : null);
  applyTransform();
  setStatus(state.showAliases ? "Alias nodes shown" : `Collapsed ${state.fullGraph.aliases?.length || 0} alias node(s)`);
}

function updateViewControls() {
  const focusedContext = getFocusedRootContext();
  const selectedCompareCell = state.compare.active && state.compare.selectedKind === "cell";
  const hasRoot = state.compare.active
    ? focusedContext.roots.length > 0 || selectedCompareCell
    : Boolean(state.selectedNodeId || state.focusedRootNodeIds.length || state.coneRootNodeId);
  const isFocused = state.compare.active
    ? focusedContext.roots.length > 0
    : state.viewMode === "focused";
  elements.wholeViewButton.classList.toggle("is-active", state.compare.active ? !isFocused : state.viewMode === "whole");
  elements.focusedViewButton.classList.toggle("is-active", isFocused);
  elements.focusedViewButton.disabled = !hasRoot;
  elements.coneDepthInput.disabled = !state.compare.active || !state.compare.outputName;
  elements.faninDepthInput.disabled = state.compare.active ? !isFocused : state.viewMode !== "focused";
  elements.fanoutDepthInput.disabled = state.compare.active ? !isFocused : state.viewMode !== "focused";
  elements.showAliasesInput.checked = state.showAliases;
  elements.fanoutHubsInput.checked = state.useFanoutHubs;
  elements.collapseGroupsInput.checked = state.collapseLargeGroups;
  elements.collapseAllButton.disabled = state.expandedGroupIds.size === 0;
  updateModuleHistoryControls();
  updateFocusedRootControl();
  updateFocusSelectedControl();
  renderFocusedRootList();
}

function updateFocusedRootControl() {
  const focusedContext = getFocusedRootContext();
  const target = state.compare.active
    ? (state.compare.selectedKind === "cell"
      ? findCompareNode(focusedContext.fullGraph, "cell", state.compare.selectedName)?.id || null
      : null)
    : resolveFocusedRootTarget(
      state.fullGraph,
      state.selectedNodeId,
      state.focusedRootNodeIds,
      state.viewMode
    );
  elements.setFocusedRootButton.disabled = !target;
  const selectedCell = state.compare.active
    ? Boolean(target)
    : Boolean(getSelectedSingleCell());
  const selectedNodeId = target || getSelectedSingleCell()?.id || state.selectedNodeId;
  elements.addFocusedRootButton.disabled = !selectedCell || focusedContext.roots.includes(selectedNodeId);
  elements.removeFocusedRootButton.disabled = !selectedCell || !focusedContext.roots.includes(selectedNodeId);
  elements.clearFocusedRootsButton.disabled = focusedContext.roots.length === 0;
}

function getSelectedSingleCell() {
  return state.fullGraph?.nodes.find(
    (node) => node.id === state.selectedNodeId && node.kind === "cell"
  ) || null;
}

function getFocusedRootContext() {
  if (state.compare.active) {
    const side = state.compare.selectedSide || "left";
    return {
      compare: true,
      side,
      fullGraph: state.compare.fullGraphs?.[side] || state.compare.graphs?.[side],
      graph: state.compare.graphs?.[side],
      roots: normalizeFocusedSelectionRoots(state.compare.focusedRootNodeIds?.[side]),
      activeRootNodeId: state.compare.activeFocusedRootNodeId?.[side] || null
    };
  }
  return {
    compare: false,
    side: null,
    fullGraph: state.fullGraph,
    graph: state.graph,
    roots: normalizeFocusedSelectionRoots(state.focusedRootNodeIds),
    activeRootNodeId: state.activeFocusedRootNodeId
  };
}

function setCompareFocusedRootNodeIds(side, value, activeRootNodeId = null) {
  if (!state.compare.focusedRootNodeIds) state.compare.focusedRootNodeIds = { left: [], right: [] };
  if (!state.compare.focusedRootNodeIds[side]) state.compare.focusedRootNodeIds[side] = [];
  if (!state.compare.activeFocusedRootNodeId) {
    state.compare.activeFocusedRootNodeId = { left: null, right: null };
  }
  const resolved = resolveFocusedRootState(value, activeRootNodeId, state.compare.activeFocusedRootNodeId[side]);
  const mirrored = legacyCompareSessions.replaceRoots(side, resolved.rootNodeIds, resolved.activeRootNodeId);
  const roots = mirrored.rootNodeIds;
  state.compare.focusedRootNodeIds[side] = roots;
  state.compare.activeFocusedRootNodeId[side] = mirrored.activeRootNodeId;
  state.compare.outputName = null;
  return roots;
}

function syncCompareFocusedRootNode(side, nodeId, operation) {
  if (state.compare.focusedRootsSynchronized === false) return null;
  const oppositeSide = side === "left" ? "right" : "left";
  if (operation === "clear") {
    setCompareFocusedRootNodeIds(oppositeSide, []);
    return null;
  }
  const sourceNode = state.compare.fullGraphs?.[side]?.nodes.find((node) => node.id === nodeId);
  const oppositeGraph = state.compare.fullGraphs?.[oppositeSide] || state.compare.graphs?.[oppositeSide];
  const oppositeNode = findCompareNode(oppositeGraph, "cell", getCompareNodeName(sourceNode));
  if (!oppositeNode) return null;
  const currentRoots = normalizeFocusedSelectionRoots(state.compare.focusedRootNodeIds?.[oppositeSide]);
  if (operation === "replace") {
    setCompareFocusedRootNodeIds(oppositeSide, [oppositeNode.id], oppositeNode.id);
  } else if (operation === "remove") {
    setCompareFocusedRootNodeIds(oppositeSide, currentRoots.filter((id) => id !== oppositeNode.id));
  } else if (operation === "add") {
    setCompareFocusedRootNodeIds(oppositeSide, addFocusedRootNodeId(currentRoots, oppositeNode.id), oppositeNode.id);
  }
  return oppositeNode;
}

function setSelectedAsFocusedRoot() {
  if (state.compare.active) {
    setSelectedCompareAsFocusedRoot();
    return;
  }
  const nodeId = resolveFocusedRootTarget(
    state.fullGraph,
    state.selectedNodeId,
    state.focusedRootNodeIds,
    state.viewMode
  );
  if (!nodeId || state.compare.active) return;
  const fullNode = state.fullGraph.nodes.find((node) => node.id === nodeId);
  const commandResult = legacyViewCommands.dispatch({
    type: "focus.set",
    objectRef: legacyViewCommands.objectRefForNode(fullNode)
  });
  if (commandResult.rejected) return;
  const requestId = ++state.selectionFocusRequestId;
  state.transform = { x: 0, y: 0, scale: 1 };
  updateViewControls();
  setStatus("Rebuilding Focused view around selected cell…");
  renderCurrentModuleGraph({
    onRendered: (graph) => {
      if (requestId !== state.selectionFocusRequestId || !state.focusedRootNodeIds.includes(nodeId)) return;
      const node = graph.nodes.find((item) => item.id === nodeId);
      if (!node) return;
      setSelectedNode(nodeId);
      focusPositionedCell(node, elements.mount, state.transform, (transform) => { state.transform = transform; });
      applyTransform();
      setStatus(`Focused neighborhood root: ${node.label}`);
    }
  });
}

function setSelectedCompareAsFocusedRoot() {
  const context = getFocusedRootContext();
  const node = findCompareNode(context.fullGraph, "cell", state.compare.selectedName);
  if (!node) return;
  setCompareFocusedRootNodeIds(context.side, [node.id], node.id);
  const matchedNode = syncCompareFocusedRootNode(context.side, node.id, "replace");
  state.compare.transforms[context.side] = { x: 0, y: 0, scale: 1 };
  updateViewControls();
  renderCompareGraphs();
  setStatus(`Focused compare ${context.side} view around ${node.label}${state.compare.focusedRootsSynchronized !== false && !matchedNode ? " (no matching cell on other side)" : ""}`);
}

function addSelectedAsFocusedRoot() {
  if (state.compare.active) {
    addSelectedCompareAsFocusedRoot();
    return;
  }
  const node = getSelectedSingleCell();
  if (!node || state.focusedRootNodeIds.includes(node.id)) return;
  const action = legacyViewCommands.dispatch({
    type: "focus.add",
    objectRef: legacyViewCommands.objectRefForNode(node)
  });
  if (action.rejected) { setStatus("Focused root limit reached"); return; }
  const requestId = ++state.selectionFocusRequestId;
  state.transform = { x: 0, y: 0, scale: 1 };
  updateViewControls();
  renderCurrentModuleGraph({
    onRendered: (graph) => {
      if (requestId !== state.selectionFocusRequestId || !state.focusedRootNodeIds.includes(node.id)) return;
      const positioned = graph.nodes.find((item) => item.id === node.id);
      if (positioned) setSelectedNode(positioned.id);
      setStatus(`Added Focused root: ${node.label}`);
    }
  });
}

function addSelectedCompareAsFocusedRoot() {
  const context = getFocusedRootContext();
  const node = findCompareNode(context.fullGraph, "cell", state.compare.selectedName);
  if (!node || context.roots.includes(node.id)) return;
  const action = resolveFocusedRootAction({ rootNodeIds: context.roots }, { type: "add", nodeId: node.id });
  if (action.rejected) { setStatus("Focused root limit reached"); return; }
  setCompareFocusedRootNodeIds(context.side, action.rootNodeIds, node.id);
  const matchedNode = syncCompareFocusedRootNode(context.side, node.id, "add");
  state.compare.transforms[context.side] = { x: 0, y: 0, scale: 1 };
  updateViewControls();
  renderCompareGraphs();
  setStatus(`Added ${node.label} to Compare ${context.side} Focused roots${state.compare.focusedRootsSynchronized !== false && !matchedNode ? " (no matching cell on other side)" : ""}`);
}

function removeSelectedFromFocusedRoots() {
  if (state.compare.active) {
    removeSelectedCompareFocusedRoot();
    return;
  }
  const nodeId = state.selectedNodeId;
  if (!state.focusedRootNodeIds.includes(nodeId)) return;
  const fullNode = state.fullGraph?.nodes.find((node) => node.id === nodeId);
  if (!fullNode) return;
  legacyViewCommands.dispatch({
    type: "focus.remove",
    objectRef: legacyViewCommands.objectRefForNode(fullNode)
  });
  const nextRoots = state.focusedRootNodeIds;
  if (nextRoots.length === 0) {
    state.viewMode = shouldUseSearchFirst(state.currentModule, SEARCH_FIRST_NODE_THRESHOLD)
      ? "search-first" : "whole";
  } else {
    state.viewMode = "focused";
  }
  state.transform = { x: 0, y: 0, scale: 1 };
  renderCurrentModuleGraph();
  setStatus(nextRoots.length ? "Removed selected Focused root" : "Cleared final Focused root");
}

function removeSelectedCompareFocusedRoot() {
  const context = getFocusedRootContext();
  const node = findCompareNode(context.fullGraph, "cell", state.compare.selectedName);
  if (!node || !context.roots.includes(node.id)) return;
  const roots = context.roots.filter((nodeId) => nodeId !== node.id);
  setCompareFocusedRootNodeIds(context.side, roots);
  syncCompareFocusedRootNode(context.side, node.id, "remove");
  state.compare.transforms[context.side] = { x: 0, y: 0, scale: 1 };
  updateViewControls();
  renderCompareGraphs();
  setStatus(roots.length
    ? `Removed ${node.label} from Compare ${context.side} Focused roots`
    : `Cleared Compare ${context.side} Focused roots`);
}

function clearFocusedRoots() {
  if (state.compare.active) {
    const context = getFocusedRootContext();
    if (context.roots.length === 0) return;
    setCompareFocusedRootNodeIds(context.side, []);
    const activeNodeId = context.activeRootNodeId;
    if (activeNodeId) syncCompareFocusedRootNode(context.side, activeNodeId, "clear");
    state.compare.transforms[context.side] = { x: 0, y: 0, scale: 1 };
    updateViewControls();
    renderCompareGraphs();
    setStatus(`Compare ${context.side} Focused roots cleared`);
    return;
  }
  if (state.focusedRootNodeIds.length === 0) return;
  setFocusedRootNodeIds(state, []);
  state.viewMode = shouldUseSearchFirst(state.currentModule, SEARCH_FIRST_NODE_THRESHOLD)
    ? "search-first" : "whole";
  state.transform = { x: 0, y: 0, scale: 1 };
  renderCurrentModuleGraph();
  setStatus("Focused roots cleared");
}

function handleFocusedRootListClick(event) {
  if (state.compare.active) {
    handleCompareFocusedRootListClick(event);
    return;
  }
  const removeButton = event.target.closest?.("[data-focused-root-remove]");
  if (removeButton) {
    const nodeId = removeButton.dataset.focusedRootRemove;
    if (!state.focusedRootNodeIds.includes(nodeId)) return;
    setFocusedRootNodeIds(state, state.focusedRootNodeIds.filter((id) => id !== nodeId));
    if (state.focusedRootNodeIds.length === 0) {
      state.viewMode = shouldUseSearchFirst(state.currentModule, SEARCH_FIRST_NODE_THRESHOLD)
        ? "search-first" : "whole";
    }
    state.transform = { x: 0, y: 0, scale: 1 };
    renderCurrentModuleGraph();
    setStatus(`Removed Focused root: ${nodeId}`);
    return;
  }
  const chip = event.target.closest?.("[data-focused-root-activate]");
  const nodeId = chip?.dataset.focusedRootActivate;
  if (!state.focusedRootNodeIds.includes(nodeId)) return;
  state.activeFocusedRootNodeId = nodeId;
  state.selectedNodeId = nodeId;
  const positioned = state.graph?.nodes.find((node) => node.id === nodeId);
  if (positioned) {
    setSelectedNode(nodeId);
    focusPositionedCell(positioned, elements.mount, state.transform, (transform) => { state.transform = transform; });
    applyTransform();
    updateViewControls();
    setStatus(`Active Focused root: ${positioned.label}`);
    return;
  }
  const requestId = ++state.selectionFocusRequestId;
  renderCurrentModuleGraph({
    onRendered: (graph) => {
      if (requestId !== state.selectionFocusRequestId || state.activeFocusedRootNodeId !== nodeId) return;
      const node = graph.nodes.find((item) => item.id === nodeId);
      if (!node) return;
      setSelectedNode(nodeId);
      focusPositionedCell(node, elements.mount, state.transform, (transform) => { state.transform = transform; });
      applyTransform();
      setStatus(`Active Focused root: ${node.label}`);
    }
  });
}

function handleCompareFocusedRootListClick(event) {
  const context = getFocusedRootContext();
  const removeButton = event.target.closest?.("[data-focused-root-remove]");
  if (removeButton) {
    const nodeId = removeButton.dataset.focusedRootRemove;
    if (!context.roots.includes(nodeId)) return;
    setCompareFocusedRootNodeIds(context.side, context.roots.filter((id) => id !== nodeId));
    syncCompareFocusedRootNode(context.side, nodeId, "remove");
    state.compare.transforms[context.side] = { x: 0, y: 0, scale: 1 };
    updateViewControls();
    renderCompareGraphs();
    setStatus(`Removed Compare ${context.side} Focused root: ${nodeId}`);
    return;
  }
  const chip = event.target.closest?.("[data-focused-root-activate]");
  const nodeId = chip?.dataset.focusedRootActivate;
  if (!context.roots.includes(nodeId)) return;
  state.compare.activeFocusedRootNodeId[context.side] = nodeId;
  state.compare.selectedSide = context.side;
  const node = context.graph?.nodes.find((item) => item.id === nodeId);
  if (node) {
    const mount = context.side === "left" ? elements.leftMount : elements.rightMount;
    focusPositionedCell(node, mount, state.compare.transforms[context.side], (transform) => {
      state.compare.transforms[context.side] = transform;
    });
    applyCompareTransforms();
    selectCompareObject("cell", getCompareNodeName(node), false, context.side);
  }
  updateViewControls();
  setStatus(`Active Compare ${context.side} Focused root: ${node?.label || nodeId}`);
}

function renderFocusedRootList() {
  if (!elements.focusedRootsList || !elements.focusedRootCount) return;
  const context = getFocusedRootContext();
  const roots = context.roots;
  elements.focusedRootCount.value = String(roots.length);
  elements.focusedRootCount.textContent = String(roots.length);
  if (roots.length === 0) {
    elements.focusedRootsList.textContent = "No roots";
    return;
  }
  elements.focusedRootsList.innerHTML = roots.map((nodeId) => {
    const node = context.fullGraph?.nodes.find((item) => item.id === nodeId);
    const label = node?.label || nodeId.replace(/^cell:/, "");
    const activeClass = nodeId === context.activeRootNodeId ? " is-active" : "";
    const title = context.compare ? `${context.side}: ${nodeId}` : nodeId;
    return `<span class="focused-root-chip${activeClass}" title="${escapeAttr(title)}" data-focused-root-activate="${escapeAttr(nodeId)}"><span>${context.compare ? `${escapeHtml(context.side)}: ` : ""}${escapeHtml(label)}</span><button type="button" aria-label="Remove ${escapeAttr(label)} from Focused roots" data-focused-root-remove="${escapeAttr(nodeId)}">×</button></span>`;
  }).join("");
}

function updateFocusSelectedControl() {
  const singleCell = !state.compare.active && state.fullGraph?.nodes.some(
    (node) => node.id === state.selectedNodeId && node.kind === "cell"
  );
  const compareCell = state.compare.active && state.compare.selectedKind === "cell" && Boolean(state.compare.selectedName);
  elements.focusSelectedButton.disabled = !(singleCell || compareCell);
}

function handleFocusSelectedShortcut(event) {
  if (event.key.toLowerCase() !== "f" || event.altKey || event.ctrlKey || event.metaKey || isEditableInputTarget(event.target)) return;
  if (elements.focusSelectedButton.disabled) return;
  event.preventDefault();
  focusSelectedCell();
}

function focusSelectedCell() {
  if (state.compare.active) {
    focusSelectedCompareCell();
    return;
  }
  const selectedNodeId = state.selectedNodeId;
  const fullNode = state.fullGraph?.nodes.find((node) => node.id === selectedNodeId && node.kind === "cell");
  if (!fullNode) return;
  const positioned = state.graph?.nodes.find((node) => node.id === selectedNodeId);
  if (positioned) {
    focusPositionedCell(positioned, elements.mount, state.transform, (transform) => { state.transform = transform; });
    applyTransform();
    setStatus(`Focused ${fullNode.label}`);
    return;
  }

  const requestId = ++state.selectionFocusRequestId;
  state.viewMode = "focused";
  setFocusedRootNodeIds(state, [selectedNodeId]);
  renderCurrentModuleGraph({
    onRendered: (graph) => {
      if (requestId !== state.selectionFocusRequestId || state.selectedNodeId !== selectedNodeId) return;
      const node = graph.nodes.find((item) => item.id === selectedNodeId);
      if (!node) return;
      focusPositionedCell(node, elements.mount, state.transform, (transform) => { state.transform = transform; });
      setSelectedNode(selectedNodeId);
      applyTransform();
      setStatus(`Focused ${node.label} in a new neighborhood`);
    }
  });
}

function selectStartupModule(moduleName) {
  const module = state.design?.modules.find(
    (item) => item.name === moduleName || item.displayName === moduleName
  );
  if (!module) return Promise.reject(new Error(`Startup module not found: ${moduleName}`));
  if (state.currentModule?.name === module.name) return Promise.resolve();
  return new Promise((resolve) => selectModule(module.name, { onRendered: resolve }));
}

function focusStartupCell(value) {
  return focusStartupCells([value]);
}

function focusStartupCells(values) {
  const focusValues = Array.isArray(values) ? values : [values];
  const nodes = focusValues.map((value) => {
    const focus = String(value).replace(/^cell:/, "");
    return state.fullGraph?.nodes.find((item) => {
      if (item.kind !== "cell") return false;
      return [item.id, item.id.replace(/^cell:/, ""), item.label, item.ref?.instance, item.ref?.instanceDisplayName]
        .includes(value) || item.ref?.instance === focus;
    });
  });
  const missingIndex = nodes.findIndex((node) => !node);
  if (missingIndex >= 0) {
    return Promise.reject(new Error(`Startup focus cell not found: ${focusValues[missingIndex]}`));
  }
  const rootNodeIds = nodes.map((node) => node.id);
  const nodeId = rootNodeIds[0];
  state.selectedNodeId = nodeId;
  state.viewMode = "focused";
  setFocusedRootNodeIds(state, rootNodeIds, nodeId);
  state.transform = { x: 0, y: 0, scale: 1 };
  updateViewControls();
  return new Promise((resolve) => {
    renderCurrentModuleGraph({
      onRendered: (graph) => {
        const positioned = graph.nodes.find((item) => item.id === nodeId);
        setSelectedNode(positioned?.id || null);
        if (positioned) {
          focusPositionedCell(positioned, elements.mount, state.transform, (transform) => { state.transform = transform; });
          applyTransform();
        }
        resolve();
      }
    });
  });
}

function focusSelectedCompareCell() {
  if (state.compare.selectedKind !== "cell" || !state.compare.selectedName) return;
  const activeSide = state.compare.selectedSide || "left";
  const sides = state.compare.synchronized ? ["left", "right"] : [activeSide];
  for (const side of sides) {
    const node = findCompareNode(state.compare.graphs[side], "cell", state.compare.selectedName);
    if (!node) continue;
    const mount = side === "left" ? elements.leftMount : elements.rightMount;
    focusPositionedCell(node, mount, state.compare.transforms[side], (transform) => {
      state.compare.transforms[side] = transform;
    });
  }
  applyCompareTransforms();
  setStatus(`Focused compare cell ${state.compare.selectedName}`);
}

function focusPositionedCell(node, mount, currentTransform, commit) {
  const svg = mount.querySelector("svg");
  if (!svg) return;
  const viewport = svg.getBoundingClientRect();
  commit(getFocusedObjectTransform({
    viewBox: svg.viewBox.baseVal,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    bounds: node,
    targetPixels: 320,
    minimumScale: 0.25,
    maximumScale: getAdaptiveMaxScale(
      svg.viewBox.baseVal.width,
      viewport.width,
      svg.viewBox.baseVal.height,
      viewport.height
    ),
    currentTransform
  }));
}

function handleGraphSimplificationChange() {
  state.useFanoutHubs = elements.fanoutHubsInput.checked;
  state.collapseLargeGroups = elements.collapseGroupsInput.checked;
  rerenderActiveGraph();
}

function rerenderActiveGraph() {
  if (state.compare.active) renderCompareGraphs();
  else renderCurrentModuleGraph();
}

function commitLayoutSpacing(key, value) {
  state.layoutPolicy.spacing[key] = value;
  syncLayoutSpacingControls();
  persistSession();
  if (!state.currentModule) return;

  if (key === "wireLanePitch" && state.compare.active) {
    renderCompareGraphs();
    renderStats();
    setStatus(`Wire spacing: ${value}px`);
    return;
  }

  if (key === "cellSpacing") {
    const selectedNodeId = state.selectedNodeId;
    const previousTransform = { ...state.transform };
    rerenderActiveGraph();
    if (!state.compare.active) {
      state.transform = previousTransform;
      state.selectedNodeId = null;
      setSelectedNode(selectedNodeId);
      applyTransform();
    }
    setStatus(`Cell spacing: ${value}px`);
    return;
  }

  const previousTransform = { ...state.transform };
  renderCurrentModuleGraph();
  state.transform = previousTransform;
  renderStats();
  renderDiagnostics();
  const selectedNode = state.selectedNodeId;
  state.selectedNodeId = null;
  setSelectedNode(selectedNode);
  applyTransform();
  setStatus(`Wire spacing: ${value}px`);
}

function commitTimingDisplayPolicy(policy) {
  state.timingDisplayPolicy = policy;
  persistSession();
  if (state.timing && state.currentModule) rerenderActiveGraph();
  const metric = policy.metrics.length === 3 ? "all" : policy.metrics[0];
  setStatus(`Timing: ${policy.snapshot} / ${metric}`);
}

function openSelectedCellDefinition() {
  const node = state.fullGraph?.nodes.find((item) => item.id === state.selectedNodeId)
    || state.graph?.nodes.find((item) => item.id === state.selectedNodeId);
  if (!node || node.kind !== "cell") {
    setStatus("Select a primitive cell first");
    return;
  }
  if (node.referencedModuleName) {
    setStatus(`${node.label}: real submodule definitions cannot be replaced by Cell Config`);
    return;
  }
  const cellType = node.ref?.type;
  activeCellDefinition = collectCellTypeSummary(state.design, cellType);
  const definition = state.cellConfig.cells[activeCellDefinition.cellType]
    || createInferredCellDefinition(activeCellDefinition);
  elements.cellDefinitionBody.innerHTML = renderCellDefinitionEditor(activeCellDefinition, definition);
  elements.deleteCellDefinitionButton.disabled = !state.cellConfig.cells[activeCellDefinition.cellType];
  if (!elements.cellDefinitionDialog.open) elements.cellDefinitionDialog.showModal();
}

function closeCellDefinitionDialog() {
  if (elements.cellDefinitionDialog.open) elements.cellDefinitionDialog.close();
  activeCellDefinition = null;
}

function saveActiveCellDefinition(event) {
  event.preventDefault();
  if (!activeCellDefinition) return;
  try {
    const definition = readCellDefinitionEditor(elements.cellDefinitionForm, activeCellDefinition);
    state.cellConfig = cellConfigUseCases.set(state.cellConfig, activeCellDefinition.cellType, definition);
    const cellType = activeCellDefinition.cellType;
    closeCellDefinitionDialog();
    rebuildAfterCellConfigChange(`${cellType}: Cell Config saved`);
  } catch (error) {
    setStatus(`Cell Config save failed: ${error.message}`);
  }
}

function deleteActiveCellDefinition() {
  if (!activeCellDefinition) return;
  const cellType = activeCellDefinition.cellType;
  state.cellConfig = cellConfigUseCases.remove(state.cellConfig, cellType);
  closeCellDefinitionDialog();
  rebuildAfterCellConfigChange(`${cellType}: saved Cell Config deleted`);
}

async function handleCellConfigImport(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const prepared = cellConfigUseCases.prepareImport(state.cellConfig, await file.text());
    if (prepared.conflicts.length && !window.confirm(`Replace ${prepared.conflicts.length} existing Cell Config definition(s): ${prepared.conflicts.join(", ")}?`)) return;
    state.cellConfig = cellConfigUseCases.commitImport(prepared);
    rebuildAfterCellConfigChange(`Imported Cell Config ${file.name}: ${Object.keys(prepared.incoming.cells).length} definition(s)`);
  } catch (error) {
    setStatus(`Cell Config import failed ${file.name}: ${error.message}`);
  } finally {
    event.target.value = "";
  }
}

function exportCellConfig() {
  browserDownload.text(`${serializeCellConfig(state.cellConfig)}\n`, "netlist-cell-config.json", "application/json");
  setStatus(`Exported ${Object.keys(state.cellConfig.cells).length} Cell Config definition(s)`);
}

function resetAllCellConfig() {
  const count = Object.keys(state.cellConfig.cells).length;
  if (count === 0) return;
  if (!window.confirm(`Remove all ${count} saved Cell Config definition(s)?`)) return;
  state.cellConfig = cellConfigUseCases.reset();
  rebuildAfterCellConfigChange("All saved Cell Config definitions reset");
}

function rebuildAfterCellConfigChange(message) {
  if (state.compare.active) {
    renderCompareGraphs();
  } else if (state.currentModule) {
    const selectedNodeId = state.selectedNodeId;
    const previousTransform = { ...state.transform };
    const refreshView = resolveCellConfigRefreshView({
      module: state.currentModule,
      fullGraph: state.fullGraph,
      selectedNodeId,
      viewMode: state.viewMode,
      focusedRootNodeIds: state.focusedRootNodeIds,
      coneRootNodeId: state.coneRootNodeId
    }, SEARCH_FIRST_NODE_THRESHOLD);
    state.viewMode = refreshView.viewMode;
    if (refreshView.viewMode === "focused" || refreshView.viewMode === "search-first") {
      setFocusedRootNodeIds(state, refreshView.rootNodeIds ||
        (refreshView.coneRootNodeId ? [refreshView.coneRootNodeId] : []));
    }
    renderCurrentModuleGraph({
      readyMessage: message,
      onRendered: (graph) => {
        state.transform = previousTransform;
        setSelectedNode(graph.nodes.some((node) => node.id === selectedNodeId) ? selectedNodeId : null);
        applyTransform();
      }
    });
  }
  updateCellDefinitionControls();
  setStatus(message);
}

function updateCellDefinitionControls(node = null) {
  const selected = node || state.fullGraph?.nodes.find((item) => item.id === state.selectedNodeId);
  elements.editCellDefinitionButton.disabled = !selected || selected.kind !== "cell" || Boolean(selected.referencedModuleName);
  elements.exportCellConfigButton.disabled = Object.keys(state.cellConfig.cells).length === 0;
  elements.resetCellConfigButton.disabled = Object.keys(state.cellConfig.cells).length === 0;
}

function setSelectedNode(nodeId) {
  state.selectionFocusRequestId += 1;
  state.selectedNodeId = nodeId;
  state.selectedNet = null;
  clearSchematicSelection();
  if (nodeId) {
    const nodeElement = elements.mount.querySelector(`[data-node-id="${cssEscape(nodeId)}"]`);
    nodeElement?.classList.add("is-selected");
  }
  const node = state.graph?.nodes.find((item) => item.id === nodeId)
    || state.fullGraph?.nodes.find((item) => item.id === nodeId)
    || null;
  renderSelection(node);
  updateViewControls();
}

function setSelectedNet(netName) {
  state.selectionFocusRequestId += 1;
  state.selectedNodeId = null;
  state.selectedNet = netName;
  clearSchematicSelection();
  for (const edgeElement of elements.mount.querySelectorAll(".edge")) {
    if (edgeElement.dataset.net === netName) {
      edgeElement.classList.add("is-selected");
    }
  }
  renderNetSelection(netName);
  updateViewControls();
}

function clearSchematicSelection() {
  for (const element of elements.mount.querySelectorAll(".node.is-selected, .edge.is-selected")) {
    element.classList.remove("is-selected");
  }
}

function handleSelectionNavigationClick(event) {
  const button = event.target.closest?.("[data-selection-target-kind]");
  if (!button) return;

  const kind = button.dataset.selectionTargetKind;
  const target = kind === "net"
    ? { kind, name: button.dataset.selectionTargetName }
    : { kind, id: button.dataset.selectionTargetId };
  if ((kind === "net" && !target.name) || (kind === "node" && !target.id)) return;

  event.preventDefault();
  if (state.compare.active) navigateCompareSelectionTarget(target);
  else navigateSingleSelectionTarget(target);
}

function navigateSingleSelectionTarget(target) {
  if (focusSingleSelectionTarget(target)) return;
  if (!selectionTargetExists(state.fullGraph, target)) {
    setStatus("Connected object is no longer available in this module");
    return;
  }

  state.viewMode = "whole";
  state.transform = { x: 0, y: 0, scale: 1 };
  updateViewControls();
  setStatus("Opening whole module to reveal the connected object…");
  renderCurrentModuleGraph({
    onRendered: () => {
      if (!focusSingleSelectionTarget(target)) {
        setStatus("Connected object is inside a collapsed group; expand the group to reveal it");
      }
    }
  });
}

function focusSingleSelectionTarget(target) {
  if (target.kind === "net") {
    const edge = state.graph?.edges.find((item) => item.net === target.name);
    if (!edge) return false;
    setSelectedNet(target.name);
    centerGraphPoint(getEdgeCenter(edge));
    setStatus(`Connected net: ${edge.label || target.name}`);
    return true;
  }

  const node = state.graph?.nodes.find((item) => item.id === target.id);
  if (!node) return false;
  setSelectedNode(node.id);
  centerGraphPoint({
    x: node.x + node.width / 2,
    y: node.y + node.height / 2
  }, node.width);
  setStatus(`Connected ${node.kind}: ${node.label}`);
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
      setStatus("Connected net is outside the current compare cone");
      return;
    }
    selectCompareObject("net", target.name, true, side);
    setStatus(`Connected net: ${target.name}`);
    return;
  }

  const node = graph?.nodes.find((item) => item.id === target.id);
  if (!node) {
    setStatus("Connected node is outside the current compare cone");
    return;
  }
  const kind = node.kind === "cell" ? "cell" : "port";
  selectCompareObject(kind, getCompareNodeName(node), true, side);
  setStatus(`Connected ${node.kind}: ${node.label}`);
}


function activateSearchResult(result) {
  if (!result) {
    return;
  }
  if (state.currentModule?.name !== result.moduleName) {
    selectModule(result.moduleName, { onRendered: () => activateSearchResult(result) });
    return;
  }

  elements.searchResults.hidden = true;
  const target = result.target;
  if (target.kind === "module") {
    setSelectedNode(null);
    setStatus(`Search: module ${result.label}`);
    return;
  }
  if (target.kind === "net") {
    const edge = state.graph?.edges.find((item) => item.net === target.name);
    setSelectedNet(target.name);
    if (edge) {
      centerGraphPoint(getEdgeCenter(edge));
    }
    setStatus(`Search: net ${result.label}`);
    return;
  }

  const fullNode = findSearchTargetNode(target, state.fullGraph);
  if (target.kind === "cell" && fullNode) {
    const reveal = legacyViewCommands.dispatch({
      type: "selection.reveal",
      objectRef: result.objectRef || legacyViewCommands.objectRefForNode(fullNode),
      visibleObjectKeys: legacyViewCommands.visibleObjectKeys()
    });
    if (!reveal.effects.layout) {
      setSelectedNode(fullNode.id);
      const positioned = state.graph?.nodes.find((node) => node.id === fullNode.id);
      if (positioned) centerGraphPoint({ x: positioned.x + positioned.width / 2, y: positioned.y + positioned.height / 2 }, positioned.width);
      setStatus(`Search: ${result.kind} ${result.label}`);
      return;
    }
    state.transform = { x: 0, y: 0, scale: 1 };
    renderCurrentModuleGraph({
      onRendered: (graph) => {
        const node = graph.nodes.find((item) => item.id === fullNode.id);
        setSelectedNode(node?.id || null);
        if (node) centerGraphPoint({ x: node.x + node.width / 2, y: node.y + node.height / 2 }, node.width);
        setStatus(`Focused ${result.label}: fanin ${state.faninDepth}, fanout ${state.fanoutDepth}`);
      }
    });
    return;
  }
  const node = findSearchTargetNode(target);
  setSelectedNode(node?.id || null);
  if (node) {
    centerGraphPoint({
      x: node.x + node.width / 2,
      y: node.y + node.height / 2
    }, node.width);
  }
  setStatus(`Search: ${result.kind} ${result.label}`);
}

function addSearchResultToFocus(result) {
  if (!result || result.target?.kind !== "cell") return;
  if (state.currentModule?.name !== result.moduleName) {
    selectModule(result.moduleName, { onRendered: () => addSearchResultToFocus(result) });
    return;
  }
  const fullNode = findSearchTargetNode(result.target, state.fullGraph);
  if (!fullNode) return;
  elements.searchResults.hidden = true;
  const action = legacyViewCommands.dispatch({
    type: "focus.add",
    objectRef: result.objectRef || legacyViewCommands.objectRefForNode(fullNode)
  });
  if (action.rejected) { setStatus("Focused root limit reached"); return; }
  if (!action.effects.layout) {
    setSelectedNode(fullNode.id);
    setStatus(`${result.label} is already a Focused root`);
    return;
  }
  state.transform = { x: 0, y: 0, scale: 1 };
  renderCurrentModuleGraph({
    onRendered: (graph) => {
      const node = graph.nodes.find((item) => item.id === fullNode.id);
      setSelectedNode(node?.id || null);
      if (node) centerGraphPoint({ x: node.x + node.width / 2, y: node.y + node.height / 2 }, node.width);
      setStatus(`Added ${result.label} to ${state.focusedRootNodeIds.length} Focused roots`);
    }
  });
}

function findSearchTargetNode(target, graph = state.graph) {
  if (target.kind === "cell") {
    return graph?.nodes.find(
      (node) => node.kind === "cell" && node.ref?.instance === target.name
    );
  }
  if (target.kind === "port") {
    const preferredKind = target.direction === "output" ? "output" : "input";
    return graph?.nodes.find(
      (node) => node.kind === preferredKind && node.ref?.name === target.name
    ) || graph?.nodes.find(
      (node) => (node.kind === "input" || node.kind === "output") && node.ref?.name === target.name
    );
  }
  return null;
}

function centerGraphPoint(point, objectWidth = 100) {
  const svg = getSvg();
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
  state.transform = {
    x: viewBox.width / 2 - point.x * scale,
    y: viewBox.height / 2 - point.y * scale,
    scale
  };
  applyTransform();
}

function getEdgeCenter(edge) {
  const points = edge?.points || [];
  const middle = points[Math.floor(points.length / 2)];
  return middle || points[0] || null;
}

function renderStats() {
  if (state.compare.active && state.compare.analysis) {
    const { left, right, delta, unmatchedPorts, unmatchedNets } = state.compare.analysis;
    const pair = (a, b) => `${a} / ${b}`;
    elements.stats.innerHTML = statsRows([
      ["Cells L/R", pair(left.cells, right.cells)],
      ["Cell delta", signed(delta.cells)],
      ["Depth L/R", pair(left.logicDepth, right.logicDepth)],
      ["Depth delta", signed(delta.logicDepth)],
      ["Max fanout L/R", pair(left.maxFanout, right.maxFanout)],
      ["Fanout delta", signed(delta.maxFanout)],
      ["Gate kinds L", formatGateKinds(left.gateKinds)],
      ["Gate kinds R", formatGateKinds(right.gateKinds)],
      ["Unmatched ports", unmatchedPorts.length],
      ["Unmatched nets L/R", pair(unmatchedNets.left.length, unmatchedNets.right.length)]
    ]);
    return;
  }
  const module = state.currentModule;
  const graph = state.graph;
  elements.stats.innerHTML = statsRows([
    ["Module", module.displayName],
    ["Ports", graph.stats.ports],
    ["Nets", graph.stats.nets],
    ["Cells", graph.stats.cells],
    ["Assigns", graph.stats.assigns],
    ["Timing inst", state.timing?.instanceCount || 0],
    ["Graph nodes", graph.nodes.length],
    ["Graph edges", graph.edges.length]
  ]);
}

function signed(value) { return value > 0 ? `+${value}` : String(value); }
function formatGateKinds(counts) { return Object.entries(counts).map(([kind, count]) => `${kind}:${count}`).join(", ") || "-"; }

function applyCompareHighlights() {
  const analysis = state.compare.analysis;
  if (!analysis) return;
  const matchedPorts = new Set(analysis.matchedPorts);
  const unmatchedPorts = new Set(analysis.unmatchedPorts);
  const commonNets = new Set(analysis.commonNets);
  for (const side of ["left", "right"]) {
    const mount = side === "left" ? elements.leftMount : elements.rightMount;
    const graph = state.compare.graphs[side];
    for (const node of mount.querySelectorAll(".node")) {
      const id = node.dataset.nodeId || "";
      const graphNode = graph.nodes.find((item) => item.id === id);
      const name = getCompareNodeName(graphNode);
      if (matchedPorts.has(name)) node.classList.add("is-compare-match");
      if (unmatchedPorts.has(name)) node.classList.add("is-compare-unmatched");
      if (graphNode?.kind === "cell") {
        node.classList.add(analysis.commonGateKinds.includes(graphNode.gateKind || "blackbox")
          ? "is-compare-match"
          : "is-compare-unmatched");
      }
    }
    for (const edge of mount.querySelectorAll(".edge")) {
      edge.classList.add(commonNets.has(edge.dataset.net) ? "is-compare-match" : "is-compare-unmatched");
    }
  }
  if (state.compare.selectedName) selectCompareObject(state.compare.selectedKind, state.compare.selectedName, false);
}

function selectCompareObject(kind, name, focus = true, selectedSide = state.compare.selectedSide) {
  state.compare.selectedKind = kind;
  state.compare.selectedName = name;
  state.compare.selectedSide = selectedSide;
  updateViewControls();
  for (const element of elements.compareMount.querySelectorAll(".is-selected")) element.classList.remove("is-selected");
  for (const side of ["left", "right"]) {
    const mount = side === "left" ? elements.leftMount : elements.rightMount;
    if (kind === "net") {
      for (const edge of mount.querySelectorAll(".edge")) if (edge.dataset.net === name) edge.classList.add("is-selected");
    } else {
      const graphNode = findCompareNode(state.compare.graphs[side], kind, name);
      if (graphNode) mount.querySelector(`[data-node-id="${cssEscape(graphNode.id)}"]`)?.classList.add("is-selected");
    }
  }
  if (focus) focusCompareSelection(kind, name);
  if (kind !== "net" && selectedSide) {
    const node = findCompareNode(state.compare.graphs[selectedSide], kind, name);
    if (node) {
      renderCompareSelection(selectedSide, node);
      return;
    }
  }
  elements.details.className = "details-block";
  elements.details.innerHTML = statsRows([["Compare object", name], ["Kind", kind], ["Present", "highlighted on both sides where available"]]);
}

function renderCompareSelection(side, node) {
  elements.details.className = "details-block";
  const instance = getNodeInstance(node);
  const choices = getTimingBadgeChoices(node, state.compare.timingBadgeChoices[side], instance);
  elements.details.innerHTML = `${statsRows([["Compare side", side]])}${renderObjectDetails(
    inspectGraphNode(state.compare.fullGraphs[side] || state.compare.graphs[side], node)
  )}${renderTimingPanel(node, choices)}${renderAdjustPanel(node, state.calibrationMode)}`;
  bindCompareSelectionControls(side, node);
}

function bindCompareSelectionControls(side, node) {
  const instance = getNodeInstance(node);
  bindTimingPanel(elements.details, {
    onPositionChange: (position) => {
      if (!instance || !isTimingBadgePosition(position)) return;
      state.compare.timingBadgePositions[side][instance] = position;
      renderCompareGraphs();
    },
    onBadgeToggle: (pin, metric, checked) => {
      if (!instance) return;
      const current = getTimingBadgeChoices(node, state.compare.timingBadgeChoices[side], instance);
      state.compare.timingBadgeChoices[side][instance] = updateTimingBadgeChoices(current, pin, metric, checked);
      renderCompareGraphs();
    },
    onReset: () => {
      if (instance) delete state.compare.timingBadgeChoices[side][instance];
      renderCompareGraphs();
    }
  });
  bindAdjustPanel(elements.details, node, state.calibrationMode, {
    onSizeChange: (size) => {
      state.compare.nodeSizes[side].set(node.id, {
        width: clamp(Number(size.width), 24, 420),
        height: clamp(Number(size.height), 12, 260)
      });
      renderCompareGraphs();
    },
    onResetSize: () => {
      state.compare.nodeSizes[side].delete(node.id);
      renderCompareGraphs();
    },
    onPropertyChange: (property, value) => {
      if (!isEditableNodeProperty(property)) return;
      const overrides = state.compare.graphOverrides[side].nodeProperties;
      overrides[node.id] ||= {};
      const trimmed = String(value ?? "").trim();
      if (trimmed) overrides[node.id][property] = trimmed;
      else delete overrides[node.id][property];
      if (Object.keys(overrides[node.id]).length === 0) delete overrides[node.id];
      renderCompareGraphs();
    },
    onResetProperties: () => {
      delete state.compare.graphOverrides[side].nodeProperties[node.id];
      renderCompareGraphs();
    },
    onPinDirectionChange: (pin, direction) => {
      if (!instance) return;
      state.compare.graphOverrides[side].cellPinDirections[instance] ||= {};
      state.compare.graphOverrides[side].cellPinDirections[instance][pin] = direction;
      renderCompareGraphs();
    },
    onResetPinDirections: () => {
      if (instance) delete state.compare.graphOverrides[side].cellPinDirections[instance];
      renderCompareGraphs();
    }
  });
}

function focusCompareSelection(kind, name) {
  for (const side of ["left", "right"]) {
    const graph = state.compare.graphs[side];
    const svg = (side === "left" ? elements.leftMount : elements.rightMount).querySelector("svg");
    const node = kind === "net" ? null : findCompareNode(graph, kind, name);
    const edgePoint = kind === "net"
      ? getEdgeCenter(graph?.edges.find((edge) => edge.net === name))
      : null;
    if ((!node && !edgePoint) || !svg) continue;
    const objectWidth = node?.width || 100;
    const point = edgePoint || {
      x: node.x + node.width / 2,
      y: node.y + node.height / 2
    };
    const scale = getReadableObjectScale({
      viewBoxWidth: svg.viewBox.baseVal.width,
      viewportWidth: svg.getBoundingClientRect().width,
      viewBoxHeight: svg.viewBox.baseVal.height,
      viewportHeight: svg.getBoundingClientRect().height,
      objectWidth,
      currentScale: state.compare.transforms[side].scale
    });
    state.compare.transforms[side] = {
      x: svg.viewBox.baseVal.width / 2 - point.x * scale,
      y: svg.viewBox.baseVal.height / 2 - point.y * scale,
      scale
    };
  }
  applyCompareTransforms();
}

function renderSelection(node) {
  if (!node) {
    updateCellDefinitionControls(null);
    elements.details.className = "details-empty";
    elements.details.textContent = "未选择对象";
    return;
  }

  updateCellDefinitionControls(node);

  elements.details.className = "details-block";
  const instance = getNodeInstance(node);
  const timingChoices = getTimingBadgeChoices(node, state.timingBadgeChoices, instance);
  elements.details.innerHTML = `${renderObjectDetails(inspectGraphNode(state.fullGraph || state.graph, node))}${renderTimingPanel(node, timingChoices)}${renderAdjustPanel(node, state.calibrationMode)}`;
  bindSelectionControls(node);
}

function renderNetSelection(netName) {
  updateCellDefinitionControls(null);
  elements.details.className = "details-block";
  elements.details.innerHTML = renderObjectDetails(inspectGraphNet(state.fullGraph || state.graph, netName));
}

function renderDiagnostics() {
  const diagnostics = [
    ...(state.design?.diagnostics || []),
    ...(state.graph?.diagnostics || [])
  ];

  elements.diagnostics.innerHTML = "";
  if (diagnostics.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No diagnostics";
    elements.diagnostics.append(item);
    return;
  }

  for (const diagnostic of diagnostics) {
    const item = document.createElement("li");
    item.textContent = diagnostic.message;
    elements.diagnostics.append(item);
  }
}

function bindSelectionControls(node) {
  const instance = getNodeInstance(node);
  bindTimingPanel(elements.details, {
    onPositionChange: (position) => updateTimingBadgePosition(node, position),
    onBadgeToggle: (pin, metric, checked) =>
      updateTimingBadgeChoice(node, pin, metric, checked),
    onReset: () => {
      if (instance) {
        delete state.timingBadgeChoices[instance];
      }
      rerenderPreservingView(node.id);
      setStatus(`${node.label}: timing badges reset to input AT plus output AT and slack`);
    }
  });

  bindAdjustPanel(elements.details, node, state.calibrationMode, {
    onSizeChange: (size) => updateNodeSize(node.id, size),
    onResetSize: () => {
      state.nodeSizes.delete(node.id);
      rerenderPreservingView(node.id);
      setStatus(`${node.label}: size reset`);
    },
    onPropertyChange: (property, value) => updateNodeProperty(node.id, property, value),
    onResetProperties: () => {
      delete state.graphOverrides.nodeProperties[node.id];
      rerenderPreservingView(node.id);
      setStatus(`${node.label}: properties reset`);
    },
    onPinDirectionChange: (pin, direction) => updateCellPinDirection(node, pin, direction),
    onResetPinDirections: () => {
      if (instance) {
        delete state.graphOverrides.cellPinDirections[instance];
      }
      rerenderPreservingView(node.id);
      setStatus(`${node.label}: pin directions reset`);
    }
  });
}

function updateTimingBadgePosition(node, position) {
  const instance = getNodeInstance(node);
  if (!instance || !isTimingBadgePosition(position)) {
    return;
  }
  state.timingBadgePositions[instance] = position;
  rerenderPreservingView(node.id);
  setStatus(`${node.label}: timing badges ${position}`);
}

function updateNodeSize(nodeId, size) {
  const node = state.graph?.nodes.find((item) => item.id === nodeId);
  if (!node) {
    return;
  }

  const nextSize = {
    width: clamp(Number(size.width), 24, 420),
    height: clamp(Number(size.height), 12, 260)
  };
  const previous = state.nodeSizes.get(nodeId);
  if (previous?.width === nextSize.width && previous?.height === nextSize.height) {
    return;
  }

  state.nodeSizes.set(nodeId, nextSize);
  rerenderPreservingView(nodeId);
  setStatus(`${node.label}: width=${nextSize.width}, height=${nextSize.height}`);
}

function updateNodeProperty(nodeId, property, value) {
  const node = state.graph?.nodes.find((item) => item.id === nodeId);
  if (!node || !isEditableNodeProperty(property)) {
    return;
  }
  const trimmed = String(value ?? "").trim();
  if (!state.graphOverrides.nodeProperties[nodeId]) {
    state.graphOverrides.nodeProperties[nodeId] = {};
  }
  if (trimmed === "") {
    delete state.graphOverrides.nodeProperties[nodeId][property];
  } else {
    state.graphOverrides.nodeProperties[nodeId][property] = trimmed;
  }
  if (Object.keys(state.graphOverrides.nodeProperties[nodeId]).length === 0) {
    delete state.graphOverrides.nodeProperties[nodeId];
  }
  rerenderPreservingView(nodeId);
  setStatus(`${node.label}: ${property} updated`);
}

function updateCellPinDirection(node, pinName, direction) {
  const instance = getNodeInstance(node);
  if (!instance || (direction !== "input" && direction !== "output")) {
    return;
  }
  if (!state.graphOverrides.cellPinDirections[instance]) {
    state.graphOverrides.cellPinDirections[instance] = {};
  }
  state.graphOverrides.cellPinDirections[instance][pinName] = direction;
  rerenderPreservingView(node.id);
  setStatus(`${node.label}.${pinName}: ${direction}`);
}

function updateTimingBadgeChoice(node, pin, metric, checked) {
  const instance = getNodeInstance(node);
  if (!instance) {
    return;
  }
  const choices = getTimingBadgeChoices(node, state.timingBadgeChoices, instance);
  state.timingBadgeChoices[instance] = updateTimingBadgeChoices(choices, pin, metric, checked);
  rerenderPreservingView(node.id);
  setStatus(`${node.label}: ${checked ? "show" : "hide"} ${pin} ${metric}`);
}

function rerenderPreservingView(selectedNodeId) {
  const previousTransform = { ...state.transform };
  renderCurrentModuleGraph();
  state.transform = previousTransform;
  state.selectedNodeId = null;
  setSelectedNode(selectedNodeId);
  applyTransform();
}

function handleWheel(event) {
  if (state.compare.active) {
    handleCompareWheel(event);
    return;
  }
  const svg = getSvg();
  if (!svg) {
    return;
  }
  event.preventDefault();
  queueWheelGesture({
    mode: "single",
    clientX: event.clientX,
    clientY: event.clientY,
    deltaY: event.deltaY
  });
}

function handlePointerDown(event) {
  if (state.compare.active) {
    handleComparePointerDown(event);
    return;
  }
  const svg = getSvg();
  if (!svg || event.button !== 0) {
    return;
  }

  const nodeElement = event.target.closest("[data-node-id]");
  if (state.calibrationMode && nodeElement) {
    startNodeDrag(event, nodeElement.dataset.nodeId);
    return;
  }
  if (nodeElement) {
    const groupNode = state.graph?.nodes.find((node) => node.id === nodeElement.dataset.nodeId && node.kind === "group");
    if (groupNode) {
      state.expandedGroupIds.add(groupNode.ref.groupId);
      renderCurrentModuleGraph();
      return;
    }
    const clickedNode = state.graph?.nodes.find((node) => node.id === nodeElement.dataset.nodeId);
    if (event.shiftKey && clickedNode?.kind === "cell") {
      const nextRoots = toggleFocusedRootNodeId(state.focusedRootNodeIds, clickedNode.id);
      setSelectedNode(clickedNode.id);
      setFocusedRootNodeIds(state, nextRoots,
        nextRoots.includes(clickedNode.id) ? clickedNode.id : null);
      state.viewMode = nextRoots.length > 0 ? "focused" : "whole";
      state.transform = { x: 0, y: 0, scale: 1 };
      renderCurrentModuleGraph();
      setStatus(nextRoots.includes(clickedNode.id)
        ? `Added Focused root: ${clickedNode.label}`
        : `Removed Focused root: ${clickedNode.label}`);
      return;
    }
    setSelectedNode(nodeElement.dataset.nodeId);
    return;
  }

  const edgeElement = event.target.closest("[data-edge-id]");
  if (edgeElement) {
    setSelectedNet(edgeElement.dataset.net);
    return;
  }

  startCanvasPan({
    event,
    target: elements.canvas,
    svg,
    transform: state.transform,
    commit(transform) {
      state.transform = transform;
      applyTransform(false);
    },
    onEnd({ didPan, cancelled }) {
      persistSession();
      if (!didPan && !cancelled) setSelectedNode(null);
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
    sourceModule = getCompareModule(side);
  } else {
    node = state.graph?.nodes.find((item) => item.id === nodeElement.dataset.nodeId);
  }
  if (!node?.referencedModuleName) return;

  const referencedModule = findReferencedModule(state.design, node);
  if (!referencedModule) {
    setStatus(`Module definition not found: ${node.referencedModuleName}`);
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  if (state.compare.active) exitCompareView();
  const readyMessage = `Opened submodule ${referencedModule.displayName} from ${sourceModule?.displayName || "module"}.${node.label}`;
  selectModule(referencedModule.name, { readyMessage });
  setStatus(readyMessage);
}

function startNodeDrag(event, nodeId) {
  const node = state.graph?.nodes.find((item) => item.id === nodeId);
  if (!node) {
    return;
  }

  setSelectedNode(nodeId);
  startCanvasNodeDrag({
    event,
    target: elements.canvas,
    mount: elements.mount,
    graph: state.graph,
    node,
    getPreviousPosition: () => state.nodePositions.get(nodeId),
    updatePosition: (position) => state.nodePositions.set(nodeId, position),
    onPreview({ position, snap }) {
      if (snap) {
        setStatus(`${node.label}: snapped ${snap.net} to y=${snap.targetY}`);
      } else {
        setStatus(`${node.label}: x=${position.x}, y=${position.y}`);
      }
    },
    onCommit({ preview }) {
      setStatus(`Rerouting ${node.label}…`);
      runAfterNextPaint(() => commitNodeDrag(nodeId, preview));
    }
  });
}

function commitNodeDrag(nodeId, preview) {
  if (!state.autoGraph) {
    preview.clear();
    renderCurrentModuleGraph();
    return;
  }
  state.graph = applyWorkspaceOverrides(state.autoGraph, {
    nodePositions: state.nodePositions,
    nodeSizes: state.nodeSizes,
    layoutPolicy: state.layoutPolicy
  });
  state.scene = createNetlistScene(state.graph);
  preview.clear();
  renderGraphMount(elements.mount, state.graph, { scene: state.scene }).then((result) => {
    if (result?.cancelled) return;
    setSelectedNode(nodeId);
    applyTransform();
    updateCalibrationControls();
    setStatus(`Layout overrides: ${state.nodePositions.size} moved node(s)`);
  });
}

function fitToView() {
  if (state.compare.active) {
    state.compare.transforms.left = { x: 0, y: 0, scale: 1 };
    state.compare.transforms.right = { x: 0, y: 0, scale: 1 };
    applyCompareTransforms();
    setStatus("Fit both compare views");
    return;
  }
  state.transform = { x: 0, y: 0, scale: 1 };
  applyTransform();
}

function exportCurrentSvg() {
  if (!state.graph || !state.currentModule) {
    return;
  }
  const viewSuffix = state.viewMode === "whole"
    ? "whole"
    : `${state.viewMode}-depth-${state.coneDepth}`;
  const fileName = `${sanitizeDownloadFileName(state.currentModule.name)}-${viewSuffix}.svg`;
  browserDownload.text(createStandaloneSvg(renderSvgScene(state.scene)), fileName, "image/svg+xml");
  logProcess("info", "export", `Exported SVG: ${fileName}`, {
    nodeCount: state.graph.nodes.length,
    edgeCount: state.graph.edges.length
  });
  setStatus(`Exported SVG: ${fileName}`);
}

function toggleCalibrationMode() {
  state.calibrationMode = !state.calibrationMode;
  updateCalibrationControls();
  setStatus(state.calibrationMode ? "Layout calibration mode enabled" : "Layout calibration mode disabled");
}

function resetLayoutOverrides() {
  if (state.compare.active) {
    state.compare.nodePositions = { left: new Map(), right: new Map() };
    state.compare.nodeSizes = { left: new Map(), right: new Map() };
    state.compare.graphOverrides = { left: createEmptyGraphOverrides(), right: createEmptyGraphOverrides() };
    renderCompareGraphs();
    updateCalibrationControls();
    setStatus("Compare Adjust overrides cleared");
    return;
  }
  if (state.nodePositions.size === 0 && state.nodeSizes.size === 0 && countGraphOverrides() === 0) {
    return;
  }

  const selectedNode = state.selectedNodeId;
  state.nodePositions = new Map();
  state.nodeSizes = new Map();
  state.graphOverrides = createEmptyGraphOverrides();
  renderCurrentModuleGraph();
  setSelectedNode(selectedNode);
  applyTransform();
  setStatus("Adjust overrides cleared");
}

function loadLayoutGolden(imported, label) {
  const module = resolveLayoutGoldenModule(state.design, imported, currentPersistenceIdentity());

  if (state.compare.active) exitCompareView();
  if (state.currentModule?.name !== module.name) selectModule(module.name);
  applyLayoutGoldenState(state, imported);

  elements.coneDepthInput.value = String(state.coneDepth);
  syncLayoutSpacingControls();
  state.transform = { x: 0, y: 0, scale: 1 };
  state.selectedNodeId = null;
  state.selectedNet = null;
  renderSelection(null);
  updateViewControls();
  renderCurrentModuleGraph({
    readyMessage: `Loaded Golden ${label}: ${state.nodePositions.size} node position(s)`
  });
  renderStats();
  renderDiagnostics();
  updateCalibrationControls();
}

function saveLayoutGolden() {
  if (!state.graph || !state.currentModule) {
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
        activeFocusedRootNodeId: state.activeFocusedRootNodeId,
        coneDepth: state.coneDepth,
        useFanoutHubs: state.useFanoutHubs,
        collapseLargeGroups: state.collapseLargeGroups,
        expandedGroupIds: [...state.expandedGroupIds]
      }
    },
    svgSnapshot: renderSvgScene(state.scene)
  });
  browserDownload.json(
    {
      ...golden,
      diff
    },
    `layout-golden-${sanitizeDownloadFileName(state.currentModule.name)}.json`
  );
  logProcess("info", "export", `Exported layout Golden for ${state.currentModule.displayName}`, {
    movedNodeCount: diff.movedNodeCount,
    maxMove: diff.maxMove
  });
  setStatus(`Saved layout golden: ${diff.movedNodeCount} moved node(s), max move ${diff.maxMove}px`);
}

function currentPersistenceIdentity() {
  return {
    domainId: state.document?.domainId || "netlist",
    documentId: state.document?.documentId || null,
    unitId: state.currentModule?.name || null,
    sourceIdentity: {
      name: state.currentSourceLabel || state.document?.source?.name || "source",
      size: String(state.currentSource || "").length
    }
  };
}

function updateCalibrationControls() {
  elements.canvas.classList.toggle("is-calibrating", state.calibrationMode);
  elements.adjustLayoutButton.classList.toggle("is-active", state.calibrationMode);
  elements.adjustLayoutButton.setAttribute("aria-pressed", String(state.calibrationMode));
  elements.saveGoldenButton.disabled = state.compare.active || !state.graph;
  elements.resetLayoutButton.disabled = state.compare.active
    ? !hasCompareLayoutOverrides()
    : state.nodePositions.size === 0 && state.nodeSizes.size === 0 && countGraphOverrides() === 0;
  if (state.compare.active && state.compare.selectedSide && state.compare.selectedName) {
    const node = findCompareNode(
      state.compare.graphs[state.compare.selectedSide],
      state.compare.selectedKind,
      state.compare.selectedName
    );
    if (node) renderCompareSelection(state.compare.selectedSide, node);
  } else {
    renderSelection(state.graph?.nodes.find((item) => item.id === state.selectedNodeId) || null);
  }
}

function applyTransform(shouldPersist = true) {
  const content = elements.mount.querySelector("#schematicContent");
  if (!content) {
    return;
  }
  const { x, y, scale } = state.transform;
  content.setAttribute("transform", formatViewportTransform({ x, y, scale }));
  elements.canvas.classList.toggle("is-low-detail", scale < 0.65);
  if (shouldPersist) persistSession();
}

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
    if (graphNode?.kind === "group") {
      state.expandedGroupIds.add(graphNode.ref.groupId);
      renderCompareGraphs();
      return;
    }
    if (state.calibrationMode && graphNode) {
      startCompareNodeDrag(event, side, graphNode);
      return;
    }
    if (event.shiftKey && graphNode?.kind === "cell") {
      selectCompareObject("cell", getCompareNodeName(graphNode), false, side);
      toggleCompareFocusedRoot(side, graphNode.id);
      return;
    }
    selectCompareObject(graphNode?.kind === "cell" ? "cell" : "port", getCompareNodeName(graphNode), true, side);
    return;
  }
  const edgeElement = event.target.closest("[data-edge-id]");
  if (edgeElement) {
    selectCompareObject("net", edgeElement.dataset.net, true, side);
    return;
  }
  startCanvasPan({
    event,
    target: elements.canvas,
    svg,
    transform: state.compare.transforms[side],
    commit: (transform) => setCompareTransform(side, transform)
  });
}

function toggleCompareFocusedRoot(side, nodeId) {
  const roots = normalizeFocusedSelectionRoots(state.compare.focusedRootNodeIds?.[side]);
  const nextRoots = toggleFocusedRootNodeId(roots, nodeId);
  setCompareFocusedRootNodeIds(side, nextRoots, nextRoots.includes(nodeId) ? nodeId : null);
  const matchedNode = syncCompareFocusedRootNode(side, nodeId, nextRoots.includes(nodeId) ? "add" : "remove");
  state.compare.transforms[side] = { x: 0, y: 0, scale: 1 };
  updateViewControls();
  renderCompareGraphs();
  const node = state.compare.fullGraphs?.[side]?.nodes.find((item) => item.id === nodeId);
  const missingMatch = state.compare.focusedRootsSynchronized !== false && nextRoots.includes(nodeId) && !matchedNode;
  setStatus(nextRoots.includes(nodeId)
    ? `Added Compare ${side} Focused root: ${node?.label || nodeId}${missingMatch ? " (no matching cell on other side)" : ""}`
    : `Removed Compare ${side} Focused root: ${node?.label || nodeId}`);
}

function startCompareNodeDrag(event, side, node) {
  const mount = side === "left" ? elements.leftMount : elements.rightMount;
  selectCompareObject(node.kind === "cell" ? "cell" : "port", getCompareNodeName(node), false, side);
  startCanvasNodeDrag({
    event,
    target: elements.canvas,
    mount,
    graph: state.compare.graphs[side],
    node,
    getPreviousPosition: () => state.compare.nodePositions[side].get(node.id),
    updatePosition: (position) => state.compare.nodePositions[side].set(node.id, position),
    onCommit({ preview }) {
      setStatus(`Rerouting ${side} ${node.label}…`);
      runAfterNextPaint(() => {
        preview.clear();
        renderAdjustedCompareSide(side).then((result) => {
          if (!result?.cancelled) setStatus(`${side} ${node.label}: position adjusted`);
        });
      });
    }
  });
}

function queueWheelGesture(sample) {
  wheelGestureController.queue(sample);
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
  state.transform = getSteppedZoomedTransform(
    state.transform,
    point,
    sample.steps,
    svg.viewBox.baseVal.width,
    rect.width,
    0.25,
    svg.viewBox.baseVal.height,
    rect.height
  );
  applyTransform(false);
}

function runAfterNextPaint(task) {
  const requestFrame = globalThis.requestAnimationFrame ||
    ((callback) => globalThis.setTimeout(callback, 0));
  requestFrame(() => globalThis.setTimeout(task, 0));
}

function renderAdjustedCompareSide(side, renderOptions = {}) {
  const autoGraph = state.compare.autoGraphs[side];
  if (!autoGraph) {
    renderCompareGraphs();
    return Promise.resolve();
  }
  const graph = applyWorkspaceOverrides(autoGraph, {
    nodePositions: state.compare.nodePositions[side],
    nodeSizes: state.compare.nodeSizes[side],
    layoutPolicy: state.layoutPolicy
  });
  state.compare.graphs[side] = graph;
  state.compare.scenes[side] = createNetlistScene(graph);
  const mount = side === "left" ? elements.leftMount : elements.rightMount;
  return renderGraphMount(mount, graph, { ...renderOptions, scene: state.compare.scenes[side] }).then((result) => {
    if (result?.cancelled) return result;
    applyCompareHighlights();
    applyCompareTransforms();
    updateCalibrationControls();
    return result;
  });
}

function setCompareTransform(side, transform) {
  state.compare.transforms[side] = transform;
  if (state.compare.synchronized) state.compare.transforms[side === "left" ? "right" : "left"] = { ...transform };
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

function setStatus(message) {
  elements.status.textContent = message;
}

function logProcess(level, phase, message, details = undefined, options = {}) {
  processLogController.append(level, phase, message, details, options);
}

function applySessionPreferences(session) {
  if (session) {
    state.coneDepth = clamp(Number(session.coneDepth) || 3, 1, 99);
    state.faninDepth = clamp(Number.isFinite(Number(session.faninDepth)) ? Number(session.faninDepth) : 3, 0, 99);
    state.fanoutDepth = clamp(Number.isFinite(Number(session.fanoutDepth)) ? Number(session.fanoutDepth) : 3, 0, 99);
    setFocusedRootNodeIds(state, normalizeFocusedRootNodeIds(
      session.focusedRootNodeIds,
      session.coneRootNodeId
    ), session.activeFocusedRootNodeId);
    state.showAliases = Boolean(session.showAliases);
    state.layoutProviderId = session.layoutProviderId || state.layoutProviderId;
    state.useFanoutHubs = session.useFanoutHubs !== false;
    state.collapseLargeGroups = session.collapseLargeGroups === true;
    if (session.layoutPolicy) state.layoutPolicy = normalizeLayoutPolicy(session.layoutPolicy);
    const snapshot = ["auto", "global", "local"].includes(session.timingDisplayPolicy?.snapshot)
      ? session.timingDisplayPolicy.snapshot : "auto";
    const metrics = session.timingDisplayPolicy?.metrics;
    state.timingDisplayPolicy = {
      snapshot,
      metrics: Array.isArray(metrics) && metrics.length ? metrics : ["slack"]
    };
  }
  elements.coneDepthInput.value = String(state.coneDepth);
  elements.faninDepthInput.value = String(state.faninDepth);
  elements.fanoutDepthInput.value = String(state.fanoutDepth);
  syncLayoutSpacingControls();
  timingDisplayController.sync();
}

function syncLayoutSpacingControls() {
  layoutSpacingController.sync();
}

function persistSession() {
  if (!state.currentSource) return;
  clearTimeout(sessionSaveTimer);
  sessionSaveTimer = setTimeout(() => saveSessionState(createSessionSnapshot(state)), 150);
}

function isEditableNodeProperty(property) {
  return ["label", "title", "subtitle", "gateKind", "inferenceSource"].includes(property);
}

function getNodeInstance(node) {
  return node.ref?.instance || (node.id.startsWith("cell:") ? node.id.slice("cell:".length) : null);
}

function countGraphOverrides() {
  return (
    Object.keys(state.graphOverrides.nodeProperties).length +
    Object.keys(state.graphOverrides.cellPinDirections).length
  );
}

function hasCompareLayoutOverrides() {
  return ["left", "right"].some((side) =>
    state.compare.nodePositions[side].size > 0 ||
    state.compare.nodeSizes[side].size > 0 ||
    Object.keys(state.compare.graphOverrides[side].nodeProperties).length > 0 ||
    Object.keys(state.compare.graphOverrides[side].cellPinDirections).length > 0
  );
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) {
    return globalThis.CSS.escape(value);
  }
  return String(value).replaceAll('"', '\\"');
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
