import { inspectGraphNet, inspectGraphNode } from "../analysis/graphInspector.js";
import { recommendModulePair } from "../analysis/moduleCompare.js";
import {
  compareLayoutGraphs,
  createLayoutGolden,
  getLayoutGoldenState
} from "../domains/netlist/layout_golden.js";
import {
  DEFAULT_LAYOUT_POLICY,
  normalizeLayoutPolicy
} from "../layout/layoutPolicy.js";
import { getLayoutProvider, listLayoutProviders } from "../layout/layoutProvider.js";
import { createNetlistScene } from "../domains/netlist/netlist_scene.js";
import { normalizeNetlistPresentationPolicy } from "../domains/netlist/netlist_presentation_policy.js";
import { cancelSchematicRender, renderSvgSceneIntoMount } from "../render/progressiveSvgRenderer.js";
import { createRenderGeneration } from "../render/renderGeneration.js";
import { renderSvgScene } from "../render/svg_scene_renderer.js";
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
import { buildModuleHierarchy, findModuleOccurrences } from "../domains/netlist/module_hierarchy.js";
import { createSchematicSelectionController } from "../ui/schematic_selection_controller.js";
import { createBrowserDownload, sanitizeDownloadFileName } from "../platform/browser_download.js";
import { importTimingSource } from "../domains/netlist/timing_import.js";
import {
  parseCellConfig,
  serializeCellConfig,
} from "../infer/cellConfig.js";
import { loadStoredCellConfig, saveStoredCellConfig } from "../persistence/cell_config_storage.js";
import { createSourceIdentity } from "../persistence/source_identity.js";
import { createCellConfigUseCases } from "../domains/netlist/cell_config_use_cases.js";
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
  focusedNetName,
  focusedNetRootId,
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
import { createSingleViewSessionBridge } from "./single_view_session_bridge.js";
import { createCompareViewSessionBridge } from "./compare_view_session_bridge.js";
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
import { createDocumentStore } from "../application/document_store.js";
import { createViewSessionStore } from "../application/view_session_store.js";
import { createArtifactStore } from "../application/artifact_store.js";
import { createJobCoordinator } from "../application/job_coordinator.js";
import {
  canStepModuleHistory,
  createModuleHistoryEntry,
  pushModuleHistory,
  replaceCurrentModuleHistory,
  stepModuleHistory
} from "./moduleHistory.js";
import {
  canStepViewHistory,
  createViewHistoryEntry,
  pushViewHistory,
  replaceCurrentViewHistory,
  stepViewHistory
} from "./viewHistory.js";

const state = createAppState(DEFAULT_LAYOUT_POLICY);
const browserDownload = createBrowserDownload();
const domainRegistry = createDefaultDomainRegistry();
const netlistFeature = domainRegistry.require("netlist");
const documents = createDocumentStore();
const viewSessions = createViewSessionStore();
const workspaceArtifacts = createArtifactStore();
const workspaceJobs = createJobCoordinator({
  documents,
  sessions: viewSessions,
  artifacts: workspaceArtifacts
});
const renderGeneration = createRenderGeneration();
const singleViewSession = createSingleViewSessionBridge({
  state,
  getDocumentId: () => state.document?.documentId || null,
  sessions: viewSessions
});
const compareViewSessions = createCompareViewSessionBridge({
  state,
  getDocumentId: () => state.document?.documentId || null,
  sessions: viewSessions
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
  moduleHierarchyMenu: document.querySelector("#moduleHierarchyMenu"),
  moduleHierarchySummary: document.querySelector("#moduleHierarchySummary"),
  moduleHierarchyCurrent: document.querySelector("#moduleHierarchyCurrent"),
  moduleHierarchyFilter: document.querySelector("#moduleHierarchyFilter"),
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
  gateSymbolModeSelect: document.querySelector("#gateSymbolModeSelect"),
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
  panel: elements.moduleHierarchyMenu,
  filterInput: elements.moduleHierarchyFilter,
  getHierarchy: () => state.design ? buildModuleHierarchy(state.design) : null,
  getCurrentModuleName: () => state.currentModule?.name || null,
  getCurrentOccurrenceContext: () => state.occurrenceContext,
  navigate: selectModule
});
const schematicSelectionController = createSchematicSelectionController({
  container: elements.mount,
  onNodeSelection(nodeId) {
    const node = state.graph?.nodes.find((item) => item.id === nodeId)
      || state.fullGraph?.nodes.find((item) => item.id === nodeId)
      || null;
    singleViewSession.dispatch(node ? {
      type: "selection.set",
      objectRef: singleViewSession.objectRefForNode(node)
    } : { type: "selection.clear" });
    renderSelection(node);
    updateViewControls();
  },
  onNetSelection(netName) {
    singleViewSession.dispatch(netName ? {
      type: "selection.set",
      objectRef: singleViewSession.objectRefForNet(netName)
    } : { type: "selection.clear" });
    renderNetSelection(netName);
    updateViewControls();
  }
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
elements.moduleBackButton.addEventListener("click", () => navigateViewHistory(-1));
elements.moduleForwardButton.addEventListener("click", () => navigateViewHistory(1));
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
  state.compare.wholeRequested = !state.compare.outputName;
  if (state.compare.outputName) {
    for (const side of ["left", "right"]) compareViewSessions.dispatch(side, { type: "focus.clear" });
  }
  elements.coneDepthInput.disabled = !state.compare.outputName;
  renderCompareGraphs();
  renderStats();
  recordViewHistory();
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
elements.gateSymbolModeSelect.addEventListener("change", (event) => commitGateSymbolMode(event.target.value));
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
window.addEventListener("keydown", handleViewHistoryShortcut);
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
    if (state.document?.documentId) workspaceJobs.cancelDocument(state.document.documentId);
    state.document = documents.open(documentEnvelope);
    viewSessions.closeByDocument(documentEnvelope.documentId);
    state.design = design;
    state.currentSource = source;
    state.currentSourceLabel = label;
    state.sourceIdentity = createSourceIdentity(label, source);
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
    const restoredViewMode = restore?.viewMode ? normalizeSingleViewMode(restore.viewMode) : null;
    if (restoredViewMode && (restoredViewMode !== "focused" || restoredFocusedRoots.length > 0)) {
      state.viewMode = restoredViewMode;
      setFocusedRootNodeIds(
        state,
        restoredViewMode === "focused" ? restoredFocusedRoots : [],
        restore.activeFocusedRootNodeId
      );
      renderCurrentModuleGraph({ readyMessage });
    }
    if (restore?.transform) setSingleTransform(restore.transform);
    setStatus(readyMessage);
  } catch (error) {
    setStatus(`Load failed: ${error.message}`);
    throw error;
  }
}

function renderModuleOptions() {
  elements.moduleHierarchyFilter.value = "";
  updateModuleHierarchyPicker();
  renderCompareModuleOptions();
  renderModuleHierarchy();
}

function renderModuleHierarchy() {
  moduleHierarchyController.render();
}

function updateModuleHierarchyPicker() {
  const moduleLabel = state.currentModule?.displayName || "No module";
  const occurrencePath = state.occurrenceContext?.occurrencePath || [];
  const label = occurrencePath.length > 0
    ? `${moduleLabel} @ ${occurrencePath.join(" / ")}`
    : moduleLabel;
  elements.moduleHierarchyCurrent.textContent = label;
  elements.moduleHierarchySummary.title = state.currentModule
    ? `Browse module hierarchy (current: ${label})`
    : "Browse module hierarchy";
  elements.moduleHierarchyMenu.hidden = state.compare.active;
  if (state.compare.active) elements.moduleHierarchyMenu.open = false;
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
  state.compare.wholeRequested = false;
  clearCompareSelection();
  updateFocusSelectedControl();
  setCompareTransform("left", { x: 0, y: 0, scale: 1 }, false);
  setCompareTransform("right", { x: 0, y: 0, scale: 1 }, false);
  elements.comparePanel.hidden = false;
  updateModuleHierarchyPicker();
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
  recordViewHistory();
}

function exitCompareView() {
  state.compare.layoutAbortController?.abort();
  state.compare.layoutAbortController = null;
  workspaceJobs.cancelSession("compare:left");
  workspaceJobs.cancelSession("compare:right");
  renderGeneration.begin();
  saveCompareWorkspace(state);
  state.compare.active = false;
  updateFocusSelectedControl();
  elements.comparePanel.hidden = true;
  updateModuleHierarchyPicker();
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
  recordViewHistory();
}

function applyCompareLayout() {
  elements.compareMount.classList.toggle("is-horizontal", state.compare.layout === "horizontal");
  elements.compareMount.classList.toggle("is-vertical", state.compare.layout !== "horizontal");
}

function renderCompareGraphs(options = {}) {
  const leftModule = getCompareModule("left");
  const rightModule = getCompareModule("right");
  if (!leftModule || !rightModule) return;
  state.compare.layoutAbortController?.abort();
  const layoutController = new AbortController();
  state.compare.layoutAbortController = layoutController;
  recordViewHistory();
  const request = renderGeneration.begin();
  const requestId = request.id;
  const compareLayoutProvider = getCurrentLayoutProvider();
  logProcess("debug", "graph", `Building Compare workspace: ${leftModule.displayName} / ${rightModule.displayName}`, {
    provider: compareLayoutProvider.id
  });
  const workspaceOptions = {
    leftModule,
    rightModule,
    layoutProvider: compareLayoutProvider,
    layoutPolicy: state.layoutPolicy,
    outputName: state.compare.outputName,
    coneDepth: state.coneDepth,
    faninDepth: state.faninDepth,
    fanoutDepth: state.fanoutDepth,
    focusedRootNodeIds: state.compare.focusedRootNodeIds,
    activeFocusedRootNodeId: state.compare.activeFocusedRootNodeId,
    showAliases: state.showAliases,
    presentationPolicy: state.presentationPolicy,
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
    moduleLibrary: state.design.modules,
    forceWhole: state.compare.wholeRequested,
    artifactCache: state.workspaceArtifactCache,
    artifactIdentity: {
      documentId: state.document?.documentId || null,
      sourceRevision: state.document?.sourceRevision || 0,
      sourceIdentity: state.sourceIdentity || null,
      sessionId: "compare"
    },
    signal: layoutController.signal,
    onSideStatus: (side, status) => {
      if (state.compare.layoutAbortController !== layoutController) return;
      updateCompareSideStatus(side, side === "left" ? leftModule : rightModule, status);
    }
  };
  const renderOptions = { ...options, layoutController };
  if (compareLayoutProvider.id === "elk-layered") {
    const leftSession = compareViewSessions.beginComputation("left");
    compareViewSessions.beginComputation("right");
    const job = workspaceJobs.start({
      sessionId: leftSession.sessionId,
      kind: "compare-workspace",
      run: (context) => buildCompareWorkspace({
        ...workspaceOptions,
        signal: context.signal
      })
    });
    logProcess("info", "layout", `Compare layout started (${compareLayoutProvider.label})`, {
      requestId,
      jobId: job.context.jobId
    });
    setStatus(`Layout (${compareLayoutProvider.label})…`);
    job.promise.then((result) => {
      if (result.status !== "committed") return;
      commitCompareWorkspace(result.artifact.value, leftModule, rightModule, renderOptions);
    }).catch(handleLayoutFailure);
    return;
  }
  const leftSession = compareViewSessions.beginComputation("left");
  compareViewSessions.beginComputation("right");
  try {
    const result = workspaceJobs.runSync({
      sessionId: leftSession.sessionId,
      kind: "compare-workspace",
      run: (context) => buildCompareWorkspace({ ...workspaceOptions, signal: context.signal })
    });
    if (result.status === "committed") {
      commitCompareWorkspace(result.artifact.value, leftModule, rightModule, renderOptions);
    }
  } catch (error) {
    handleLayoutFailure(error);
  }
}

function commitCompareWorkspace(workspace, leftModule, rightModule, options = {}) {
  if (options.layoutController && (
    state.compare.layoutAbortController !== options.layoutController || options.layoutController.signal.aborted
  )) return;
  if (state.compare.layoutAbortController === options.layoutController) state.compare.layoutAbortController = null;
  state.compare.fullGraphs = workspace.fullGraphs;
  state.compare.autoGraphs = workspace.autoGraphs;
  state.compare.graphs = workspace.graphs;
  state.compare.scenes = workspace.scenes;
  state.compare.analysis = workspace.analysis;
  renderDiagnostics();
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
  options.onCommitted?.();
  });
}

function updateCompareSideStatus(side, module, status) {
  const header = elements.compareMount.querySelector(`[data-compare-side="${side}"] > header`);
  if (!header) return;
  const label = module?.displayName || module?.name || side;
  header.textContent = status === "loading"
    ? `${label} · Loading…`
    : status === "failed" ? `${label} · Failed`
      : status === "cancelled" ? `${label} · Cancelled` : label;
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
  const ambiguousOccurrences = !options.occurrencePath && !historyEntry
    ? findModuleOccurrences(buildModuleHierarchy(state.design), module.name)
    : [];
  const switchingModule = state.currentModule?.name !== module.name;
  const defaultViewMode = shouldUseSearchFirst(module, SEARCH_FIRST_NODE_THRESHOLD) ? "search-first" : "whole";
  if (state.currentModule && switchingModule) {
    if (historyMode === "push") {
      state.moduleHistory = replaceCurrentModuleHistory(state.moduleHistory, createModuleHistoryEntry(state));
    }
    saveModuleWorkspace(state, state.currentModule.name);
    singleViewSession.dispatch({
      type: "unit.set",
      unitId: module.name,
      viewMode: defaultViewMode
    });
  }
  state.currentModule = module;
  if (switchingModule && !options.occurrencePath) state.occurrenceContext = null;
  if (switchingModule) logProcess("info", "navigation", `Opened module ${module.displayName}`, { moduleName: module.name });
  const restoredWorkspace = switchingModule && restoreModuleWorkspace(state, module.name);
  if (options.occurrencePath?.length) {
    state.occurrenceContext = {
      rootModuleName: options.rootModuleName || options.occurrencePath[0] || module.name,
      occurrencePath: [...options.occurrencePath]
    };
  }
  updateModuleHierarchyPicker();
  renderModuleHierarchy();
  if (switchingModule && !restoredWorkspace && !historyEntry) state.viewMode = defaultViewMode;
  if (historyEntry) {
    applyModuleHistoryEntry(historyEntry);
  }
  if (!historyEntry) {
    setSingleTransform({ x: 0, y: 0, scale: 1 });
  }
  const requestedOnRendered = options.onRendered;
  renderCurrentModuleGraph({
    ...options,
    onRendered: (graph) => {
      if (historyEntry) restoreModuleHistorySelection(historyEntry, graph);
      requestedOnRendered?.(graph);
      if (ambiguousOccurrences.length > 1 && !state.occurrenceContext) {
        setStatus(`${module.displayName} has ${ambiguousOccurrences.length} hierarchy occurrences; choose one from Module hierarchy`);
      }
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
  recordViewHistory();
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
  state.occurrenceContext = entry.occurrenceContext ? {
    rootModuleName: entry.occurrenceContext.rootModuleName || null,
    occurrencePath: [...(entry.occurrenceContext.occurrencePath || [])]
  } : null;
  updateModuleHierarchyPicker();
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
  setSingleTransform(entry.transform);
}

function restoreModuleHistorySelection(entry, graph) {
  setSingleTransform(entry.transform);
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

function handleViewHistoryShortcut(event) {
  if (isEditableInputTarget(event.target)) return;
  const undo = (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "z" && !event.shiftKey;
  const redo = (event.ctrlKey || event.metaKey) && (
    (event.key.toLowerCase() === "z" && event.shiftKey) || event.key.toLowerCase() === "y"
  );
  if (!undo && !redo) return;
  event.preventDefault();
  navigateViewHistory(undo ? -1 : 1);
}

function navigateViewHistory(delta) {
  if (!state.currentModule) return;
  state.viewHistory = replaceCurrentViewHistory(state.viewHistory, createViewHistoryEntry(state));
  const result = stepViewHistory(state.viewHistory, delta);
  if (!result.entry) {
    updateModuleHistoryControls();
    return;
  }
  state.viewHistory = result.history;
  restoreViewHistoryEntry(result.entry);
}

function restoreViewHistoryEntry(entry) {
  state.restoringViewHistory = true;
  if (entry.kind === "compare" && entry.compare) {
    restoreCompareViewHistoryEntry(entry);
    return;
  }
  if (state.compare.active) exitCompareView();
  const finish = (graph) => {
    state.occurrenceContext = entry.occurrenceContext ? {
      rootModuleName: entry.occurrenceContext.rootModuleName || null,
      occurrencePath: [...(entry.occurrenceContext.occurrencePath || [])]
    } : null;
    updateModuleHierarchyPicker();
    state.viewMode = normalizeSingleViewMode(entry.viewMode);
    setFocusedRootNodeIds(state, entry.focusedRootNodeIds, entry.activeFocusedRootNodeId);
    state.coneDepth = entry.coneDepth;
    state.faninDepth = entry.faninDepth;
    state.fanoutDepth = entry.fanoutDepth;
    state.selectedNodeId = entry.selectedNodeId || null;
    state.selectedNet = entry.selectedNet || null;
    state.presentationPolicy = entry.presentationPolicy
      ? { ...entry.presentationPolicy }
      : state.presentationPolicy;
    state.nodePositions = new Map(entry.overrides?.nodePositions || []);
    state.nodeSizes = new Map(entry.overrides?.nodeSizes || []);
    state.graphOverrides = entry.overrides?.graphOverrides || createEmptyGraphOverrides();
    setSingleTransform(entry.transform);
    renderCurrentModuleGraph({
      onRendered: (nextGraph) => {
        if (entry.selectedNet && nextGraph.edges.some((edge) => edge.net === entry.selectedNet)) setSelectedNet(entry.selectedNet);
        else if (entry.selectedNodeId && nextGraph.nodes.some((node) => node.id === entry.selectedNodeId)) setSelectedNode(entry.selectedNodeId);
        else setSelectedNode(null);
        applyTransform();
        state.restoringViewHistory = false;
        updateModuleHistoryControls();
      }
    });
  };
  if (entry.moduleName && state.currentModule.name !== entry.moduleName) {
    selectModule(entry.moduleName, { historyMode: "restore", onRendered: finish });
  } else {
    finish(state.graph);
  }
}

function restoreCompareViewHistoryEntry(entry) {
  const compare = entry.compare;
  const pairChanged = state.compare.leftModuleName !== compare.leftModuleName
    || state.compare.rightModuleName !== compare.rightModuleName;
  if (!state.compare.active || pairChanged) {
    elements.leftModuleSelect.value = compare.leftModuleName || "";
    elements.rightModuleSelect.value = compare.rightModuleName || "";
    applyCompareSelection();
  }

  state.compare.active = true;
  state.presentationPolicy = entry.presentationPolicy
    ? { ...entry.presentationPolicy }
    : state.presentationPolicy;
  state.compare.leftModuleName = compare.leftModuleName;
  state.compare.rightModuleName = compare.rightModuleName;
  state.compare.layout = compare.layout || "vertical";
  state.compare.outputName = compare.outputName || null;
  state.compare.wholeRequested = compare.wholeRequested === true;
  state.compare.focusedRootsSynchronized = compare.focusedRootsSynchronized !== false;
  state.compare.focusedRootNodeIds = {
    left: [...(compare.focusedRootNodeIds?.left || [])],
    right: [...(compare.focusedRootNodeIds?.right || [])]
  };
  state.compare.activeFocusedRootNodeId = {
    left: compare.activeFocusedRootNodeId?.left || state.compare.focusedRootNodeIds.left[0] || null,
    right: compare.activeFocusedRootNodeId?.right || state.compare.focusedRootNodeIds.right[0] || null
  };
  state.compare.transforms = {
    left: { ...compare.transforms.left },
    right: { ...compare.transforms.right }
  };
  state.compare.selectedName = compare.selectedName || null;
  state.compare.selectedKind = compare.selectedKind || null;
  state.compare.selectedSide = compare.selectedSide || null;
  state.compare.nodePositions = {
    left: new Map(compare.overrides.left.nodePositions || []),
    right: new Map(compare.overrides.right.nodePositions || [])
  };
  state.compare.nodeSizes = {
    left: new Map(compare.overrides.left.nodeSizes || []),
    right: new Map(compare.overrides.right.nodeSizes || [])
  };
  state.compare.graphOverrides = {
    left: cloneGraphOverridesForHistory(compare.overrides.left.graphOverrides),
    right: cloneGraphOverridesForHistory(compare.overrides.right.graphOverrides)
  };
  elements.compareLayoutSelect.value = state.compare.layout;
  elements.syncCompareFocusInput.checked = state.compare.focusedRootsSynchronized;
  elements.comparePanel.hidden = false;
  elements.compareMount.hidden = false;
  elements.mount.hidden = true;
  applyCompareLayout();
  updateModuleHierarchyPicker();
  updateViewControls();
  renderCompareGraphs({
    onCommitted: () => {
      if (state.compare.selectedName && state.compare.selectedKind && state.compare.selectedSide) {
        selectCompareObject(
          state.compare.selectedKind,
          state.compare.selectedName,
          false,
          state.compare.selectedSide
        );
      }
      applyCompareTransforms();
      state.restoringViewHistory = false;
      updateModuleHistoryControls();
    }
  });
}

function cloneGraphOverridesForHistory(value = {}) {
  return {
    nodeProperties: Object.fromEntries(Object.entries(value.nodeProperties || {}).map(([id, item]) => [id, { ...item }])),
    cellPinDirections: Object.fromEntries(Object.entries(value.cellPinDirections || {}).map(([id, item]) => [id, { ...item }]))
  };
}

function updateModuleHistoryControls() {
  const validNames = state.design?.modules.map((module) => module.name) || [];
  const canViewBack = canStepViewHistory(state.viewHistory, -1) || canStepModuleHistory(state.moduleHistory, -1, validNames);
  const canViewForward = canStepViewHistory(state.viewHistory, 1) || canStepModuleHistory(state.moduleHistory, 1, validNames);
  elements.moduleBackButton.disabled = !canViewBack;
  elements.moduleForwardButton.disabled = !canViewForward;
}

function renderCurrentModuleGraph(options = {}) {
  const request = renderGeneration.begin();
  const requestId = request.id;
  const layoutProvider = getCurrentLayoutProvider();
  const hierarchyRoots = resolveHierarchyFocusedRoots();
  const hierarchyRoot = hierarchyRoots[0] || null;
  logProcess("debug", "graph", `Building ${state.currentModule?.displayName || "module"} graph`, {
    viewMode: state.viewMode,
    provider: layoutProvider.id
  });
  const workspaceOptions = {
    module: state.currentModule,
    moduleLibrary: state.design.modules,
    graphOverrides: state.graphOverrides,
    cellConfig: state.cellConfig,
    timing: state.timing,
    timingDisplayPolicy: state.timingDisplayPolicy,
    timingBadgeChoices: state.timingBadgeChoices,
    timingBadgePositions: state.timingBadgePositions,
    presentationPolicy: state.presentationPolicy,
    showAliases: state.showAliases,
    viewMode: state.viewMode,
    focusedRootNodeIds: state.focusedRootNodeIds,
    activeFocusedRootNodeId: state.activeFocusedRootNodeId,
    coneRootNodeId: state.coneRootNodeId,
    coneDepth: state.coneDepth,
    faninDepth: state.faninDepth,
    fanoutDepth: state.fanoutDepth,
    occurrencePath: state.occurrenceContext?.occurrencePath || null,
    hierarchyRoot,
    hierarchyRoots,
    useFanoutHubs: state.useFanoutHubs,
    collapseLargeGroups: state.collapseLargeGroups,
    expandedGroupIds: state.expandedGroupIds,
    layoutProvider,
    layoutPolicy: state.layoutPolicy,
    nodePositions: state.nodePositions,
    nodeSizes: state.nodeSizes,
    artifactCache: state.workspaceArtifactCache,
    artifactIdentity: {
      documentId: state.document?.documentId || null,
      sourceRevision: state.document?.sourceRevision || 0,
      sourceIdentity: state.sourceIdentity || null,
      sessionId: "single",
      unitId: state.currentModule?.name || null
    }
  };
  if (layoutProvider.id === "elk-layered") {
    const session = singleViewSession.beginComputation();
    const job = workspaceJobs.start({
      sessionId: session.sessionId,
      kind: "single-workspace",
      run: (context) => buildModuleWorkspaceForJob(workspaceOptions, context.signal)
    });
    logProcess("info", "layout", `Layout started (${layoutProvider.label})`, { requestId, jobId: job.context.jobId });
    setStatus(`Layout (${layoutProvider.label})…`);
    job.promise.then((result) => {
      if (result.status !== "committed") return;
      commitCurrentWorkspace(result.artifact.value, options);
    }).catch(handleLayoutFailure);
    return;
  }
  const session = singleViewSession.beginComputation();
  try {
    const result = workspaceJobs.runSync({
      sessionId: session.sessionId,
      kind: "single-workspace",
      run: (context) => buildModuleWorkspace({
        ...workspaceOptions,
        faninDepth: state.faninDepth,
        fanoutDepth: state.fanoutDepth,
        signal: context.signal,
        jobId: context.jobId
      })
    });
    if (result.status === "committed") commitCurrentWorkspace(result.artifact.value, options);
  } catch (error) {
    handleLayoutFailure(error);
  }
}

function buildModuleWorkspaceForJob(options, signal) {
  return buildModuleWorkspace({ ...options, signal });
}

function resolveHierarchyFocusedRoots() {
  if (state.viewMode !== "focused" || !state.currentModule || !state.fullGraph) return [];
  const roots = normalizeFocusedRootNodeIds(state.focusedRootNodeIds, state.coneRootNodeId);
  return roots.map((rootId) => {
    if (typeof rootId === "string" && rootId.startsWith("net:")) {
      return {
        rootModuleName: state.occurrenceContext?.rootModuleName || state.currentModule.name,
        moduleName: state.currentModule.name,
        occurrencePath: state.occurrenceContext?.occurrencePath || [],
        kind: "net",
        localId: rootId.slice("net:".length)
      };
    }
    const root = state.fullGraph.nodes.find((node) => node.id === rootId && node.kind === "cell");
    if (!root?.referencedModuleName && !root?.ref?.type && !root?.type) return null;
    const childType = root.referencedModuleName || root.ref?.type || root.type;
    if (!childType || !state.design?.modules.some((module) => module.name === childType)) return null;
    return {
      rootModuleName: state.occurrenceContext?.rootModuleName || state.currentModule.name,
      moduleName: state.currentModule.name,
      occurrencePath: state.occurrenceContext?.occurrencePath || [],
      kind: "cell",
      localId: root.ref?.instance || root.id.replace(/^cell:/, "")
    };
  }).filter(Boolean);
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
  renderDiagnostics();
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
  const request = renderGeneration.current();
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
  setSingleTransform({ x: 0, y: 0, scale: 1 });
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
    replaceSingleFocusedRoots(rootNodeIds);
  }
  const modeResult = setSingleViewMode(mode);
  if (modeResult?.rejected) return;
  renderCurrentModuleGraph();
  setSingleTransform({ x: 0, y: 0, scale: 1 });
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
    setCompareTransform(context.side, { x: 0, y: 0, scale: 1 });
    updateViewControls();
    renderCompareGraphs();
    setStatus(`Compare ${context.side} Focused: fanin ${state.faninDepth}, fanout ${state.fanoutDepth}`);
    return;
  }
  if (mode === "whole") {
    for (const side of ["left", "right"]) {
      setCompareFocusedRootNodeIds(side, []);
      setCompareTransform(side, { x: 0, y: 0, scale: 1 }, false);
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
  setSingleFocusedDepths(
    clamp(Math.floor(Number(elements.faninDepthInput.value) || 0), 0, 99),
    clamp(Math.floor(Number(elements.fanoutDepthInput.value) || 0), 0, 99)
  );
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
    singleViewSession.dispatch({ type: "focus.clear" });
  }
  renderCurrentModuleGraph();
  setSelectedNode(state.graph.nodes.some((node) => node.id === selectedNodeId) ? selectedNodeId : null);
  applyTransform();
  setStatus(state.showAliases ? "Alias nodes shown" : `Collapsed ${state.fullGraph.aliases?.length || 0} alias node(s)`);
}

function updateViewControls() {
  const focusedContext = getFocusedRootContext();
  const selectedCompareCell = state.compare.active && state.compare.selectedKind === "cell";
  const selectedCompareNet = state.compare.active && state.compare.selectedKind === "net";
  const hasRoot = state.compare.active
    ? focusedContext.roots.length > 0 || selectedCompareCell || selectedCompareNet
    : Boolean(state.selectedNodeId || state.selectedNet || state.focusedRootNodeIds.length || state.coneRootNodeId);
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
  const selectedCompareNet = state.compare.active && state.compare.selectedKind === "net";
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
  const selectedRootId = state.compare.active
    ? (selectedCell ? selectedNodeId : selectedCompareNet ? focusedNetRootId(state.compare.selectedName) : null)
    : (selectedCell ? selectedNodeId : state.selectedNet ? focusedNetRootId(state.selectedNet) : null);
  elements.addFocusedRootButton.disabled = !selectedRootId || focusedContext.roots.includes(selectedRootId);
  elements.removeFocusedRootButton.disabled = !selectedRootId || !focusedContext.roots.includes(selectedRootId);
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
  const mirrored = compareViewSessions.replaceRoots(side, resolved.rootNodeIds, resolved.activeRootNodeId);
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
  const rootId = nodeId || focusedNetRootId(state.selectedNet);
  if (!rootId || state.compare.active) return;
  if (focusedNetName(rootId)) {
    const commandResult = singleViewSession.dispatch({
      type: "focus.set",
      objectRef: singleViewSession.objectRefForNet(focusedNetName(rootId))
    });
    if (commandResult.rejected) return;
    setSingleTransform({ x: 0, y: 0, scale: 1 });
    updateViewControls();
    setStatus(`Rebuilding Focused view around net ${focusedNetName(rootId)}…`);
    renderCurrentModuleGraph();
    return;
  }
  const fullNode = state.fullGraph.nodes.find((node) => node.id === nodeId);
  const commandResult = singleViewSession.dispatch({
    type: "focus.set",
    objectRef: singleViewSession.objectRefForNode(fullNode)
  });
  if (commandResult.rejected) return;
  const requestId = ++state.selectionFocusRequestId;
  setSingleTransform({ x: 0, y: 0, scale: 1 });
  updateViewControls();
  setStatus("Rebuilding Focused view around selected cell…");
  renderCurrentModuleGraph({
    onRendered: (graph) => {
      if (requestId !== state.selectionFocusRequestId || !state.focusedRootNodeIds.includes(nodeId)) return;
      const node = graph.nodes.find((item) => item.id === nodeId);
      if (!node) return;
      setSelectedNode(nodeId);
      focusPositionedCell(node, elements.mount, state.transform, setSingleTransform);
      applyTransform();
      setStatus(`Focused neighborhood root: ${node.label}`);
    }
  });
}

function setSelectedCompareAsFocusedRoot() {
  const context = getFocusedRootContext();
  if (state.compare.selectedKind === "net" && state.compare.selectedName) {
    const rootId = focusedNetRootId(state.compare.selectedName);
    setCompareFocusedRootNodeIds(context.side, [rootId], rootId);
    setCompareTransform(context.side, { x: 0, y: 0, scale: 1 });
    updateViewControls();
    renderCompareGraphs();
    setStatus(`Focused compare ${context.side} view around net ${state.compare.selectedName}`);
    return;
  }
  const node = findCompareNode(context.fullGraph, "cell", state.compare.selectedName);
  if (!node) return;
  setCompareFocusedRootNodeIds(context.side, [node.id], node.id);
  const matchedNode = syncCompareFocusedRootNode(context.side, node.id, "replace");
  setCompareTransform(context.side, { x: 0, y: 0, scale: 1 });
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
  const rootId = node?.id || focusedNetRootId(state.selectedNet);
  if (!rootId || state.focusedRootNodeIds.includes(rootId)) return;
  const action = singleViewSession.dispatch({
    type: "focus.add",
    objectRef: node
      ? singleViewSession.objectRefForNode(node)
      : singleViewSession.objectRefForNet(state.selectedNet)
  });
  if (action.rejected) { setStatus("Focused root limit reached"); return; }
  const requestId = ++state.selectionFocusRequestId;
  setSingleTransform({ x: 0, y: 0, scale: 1 });
  updateViewControls();
  renderCurrentModuleGraph({
    onRendered: (graph) => {
      if (requestId !== state.selectionFocusRequestId || !state.focusedRootNodeIds.includes(rootId)) return;
      const positioned = node ? graph.nodes.find((item) => item.id === node.id) : null;
      if (positioned) setSelectedNode(positioned.id);
      setStatus(`Added Focused root: ${node?.label || `net ${state.selectedNet}`}`);
    }
  });
}

function addSelectedCompareAsFocusedRoot() {
  const context = getFocusedRootContext();
  if (state.compare.selectedKind === "net" && state.compare.selectedName) {
    const rootId = focusedNetRootId(state.compare.selectedName);
    if (context.roots.includes(rootId)) return;
    setCompareFocusedRootNodeIds(context.side, [...context.roots, rootId], rootId);
    setCompareTransform(context.side, { x: 0, y: 0, scale: 1 });
    updateViewControls();
    renderCompareGraphs();
    setStatus(`Added net ${state.compare.selectedName} to Compare ${context.side} Focused roots`);
    return;
  }
  const node = findCompareNode(context.fullGraph, "cell", state.compare.selectedName);
  if (!node || context.roots.includes(node.id)) return;
  const action = resolveFocusedRootAction({ rootNodeIds: context.roots }, { type: "add", nodeId: node.id });
  if (action.rejected) { setStatus("Focused root limit reached"); return; }
  setCompareFocusedRootNodeIds(context.side, action.rootNodeIds, node.id);
  const matchedNode = syncCompareFocusedRootNode(context.side, node.id, "add");
  setCompareTransform(context.side, { x: 0, y: 0, scale: 1 });
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
  const rootId = state.selectedNet ? focusedNetRootId(state.selectedNet) : nodeId;
  if (!rootId || !state.focusedRootNodeIds.includes(rootId)) return;
  if (focusedNetName(rootId)) {
    singleViewSession.dispatch({
      type: "focus.remove",
      objectRef: singleViewSession.objectRefForNet(focusedNetName(rootId))
    });
    const nextRoots = state.focusedRootNodeIds;
    if (nextRoots.length === 0) setSingleViewMode(shouldUseSearchFirst(state.currentModule, SEARCH_FIRST_NODE_THRESHOLD) ? "search-first" : "whole");
    setSingleTransform({ x: 0, y: 0, scale: 1 });
    renderCurrentModuleGraph();
    setStatus(nextRoots.length ? "Removed selected Focused net root" : "Cleared final Focused root");
    return;
  }
  const fullNode = state.fullGraph?.nodes.find((node) => node.id === nodeId);
  if (!fullNode) return;
  singleViewSession.dispatch({
    type: "focus.remove",
    objectRef: singleViewSession.objectRefForNode(fullNode)
  });
  const nextRoots = state.focusedRootNodeIds;
  if (nextRoots.length === 0) {
    setSingleViewMode(shouldUseSearchFirst(state.currentModule, SEARCH_FIRST_NODE_THRESHOLD)
      ? "search-first" : "whole");
  }
  setSingleTransform({ x: 0, y: 0, scale: 1 });
  renderCurrentModuleGraph();
  setStatus(nextRoots.length ? "Removed selected Focused root" : "Cleared final Focused root");
}

function removeSelectedCompareFocusedRoot() {
  const context = getFocusedRootContext();
  if (state.compare.selectedKind === "net" && state.compare.selectedName) {
    const rootId = focusedNetRootId(state.compare.selectedName);
    if (!context.roots.includes(rootId)) return;
    const roots = context.roots.filter((item) => item !== rootId);
    setCompareFocusedRootNodeIds(context.side, roots);
    setCompareTransform(context.side, { x: 0, y: 0, scale: 1 });
    updateViewControls();
    renderCompareGraphs();
    setStatus(roots.length
      ? `Removed net ${state.compare.selectedName} from Compare ${context.side} Focused roots`
      : `Cleared Compare ${context.side} Focused roots`);
    return;
  }
  const node = findCompareNode(context.fullGraph, "cell", state.compare.selectedName);
  if (!node || !context.roots.includes(node.id)) return;
  const roots = context.roots.filter((nodeId) => nodeId !== node.id);
  setCompareFocusedRootNodeIds(context.side, roots);
  syncCompareFocusedRootNode(context.side, node.id, "remove");
  setCompareTransform(context.side, { x: 0, y: 0, scale: 1 });
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
    setCompareTransform(context.side, { x: 0, y: 0, scale: 1 });
    updateViewControls();
    renderCompareGraphs();
    setStatus(`Compare ${context.side} Focused roots cleared`);
    return;
  }
  if (state.focusedRootNodeIds.length === 0) return;
  singleViewSession.dispatch({ type: "focus.clear" });
  setSingleViewMode(shouldUseSearchFirst(state.currentModule, SEARCH_FIRST_NODE_THRESHOLD)
    ? "search-first" : "whole");
  setSingleTransform({ x: 0, y: 0, scale: 1 });
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
    const netName = focusedNetName(nodeId);
    if (netName) {
      singleViewSession.dispatch({ type: "focus.remove", objectRef: singleViewSession.objectRefForNet(netName) });
      if (state.focusedRootNodeIds.length === 0) setSingleViewMode(shouldUseSearchFirst(state.currentModule, SEARCH_FIRST_NODE_THRESHOLD) ? "search-first" : "whole");
      setSingleTransform({ x: 0, y: 0, scale: 1 });
      renderCurrentModuleGraph();
      setStatus(`Removed Focused root: net ${netName}`);
      return;
    }
    const fullNode = state.fullGraph?.nodes.find((node) => node.id === nodeId);
    if (!fullNode) return;
    singleViewSession.dispatch({
      type: "focus.remove",
      objectRef: singleViewSession.objectRefForNode(fullNode)
    });
    if (state.focusedRootNodeIds.length === 0) {
      setSingleViewMode(shouldUseSearchFirst(state.currentModule, SEARCH_FIRST_NODE_THRESHOLD)
        ? "search-first" : "whole");
    }
    setSingleTransform({ x: 0, y: 0, scale: 1 });
    renderCurrentModuleGraph();
    setStatus(`Removed Focused root: ${nodeId}`);
    return;
  }
  const chip = event.target.closest?.("[data-focused-root-activate]");
  const nodeId = chip?.dataset.focusedRootActivate;
  if (!state.focusedRootNodeIds.includes(nodeId)) return;
  const netName = focusedNetName(nodeId);
  if (netName) {
    singleViewSession.dispatch({ type: "focus.activate", objectRef: singleViewSession.objectRefForNet(netName) });
    const edge = state.graph?.edges.find((item) => item.net === netName);
    if (edge) {
      focusPositionedEdge(edge, elements.mount, state.transform, setSingleTransform);
      applyTransform();
    }
    updateViewControls();
    setStatus(`Active Focused net root: ${netName}`);
    return;
  }
  const fullNode = state.fullGraph?.nodes.find((node) => node.id === nodeId);
  if (!fullNode) return;
  singleViewSession.dispatch({
    type: "focus.activate",
    objectRef: singleViewSession.objectRefForNode(fullNode)
  });
  const positioned = state.graph?.nodes.find((node) => node.id === nodeId);
  if (positioned) {
    setSelectedNode(nodeId);
    focusPositionedCell(positioned, elements.mount, state.transform, setSingleTransform);
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
      focusPositionedCell(node, elements.mount, state.transform, setSingleTransform);
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
    const netName = focusedNetName(nodeId);
    if (netName) {
      setCompareFocusedRootNodeIds(context.side, context.roots.filter((id) => id !== nodeId));
      setCompareTransform(context.side, { x: 0, y: 0, scale: 1 });
      updateViewControls();
      renderCompareGraphs();
      setStatus(`Removed Compare ${context.side} Focused net root: ${netName}`);
      return;
    }
    setCompareFocusedRootNodeIds(context.side, context.roots.filter((id) => id !== nodeId));
    syncCompareFocusedRootNode(context.side, nodeId, "remove");
    setCompareTransform(context.side, { x: 0, y: 0, scale: 1 });
    updateViewControls();
    renderCompareGraphs();
    setStatus(`Removed Compare ${context.side} Focused root: ${nodeId}`);
    return;
  }
  const chip = event.target.closest?.("[data-focused-root-activate]");
  const nodeId = chip?.dataset.focusedRootActivate;
  if (!context.roots.includes(nodeId)) return;
  const netName = focusedNetName(nodeId);
  if (netName) {
    compareViewSessions.dispatch(context.side, {
      type: "focus.activate",
      objectRef: compareViewSessions.objectRef(context.side, "net", netName)
    });
    const edge = context.graph?.edges.find((item) => item.net === netName);
    if (edge) {
      const mount = context.side === "left" ? elements.leftMount : elements.rightMount;
      focusPositionedEdge(edge, mount, state.compare.transforms[context.side], (transform) => {
        setCompareTransform(context.side, transform);
      });
      applyCompareTransforms();
      selectCompareObject("net", netName, false, context.side);
    }
    updateViewControls();
    setStatus(`Active Compare ${context.side} Focused net root: ${netName}`);
    return;
  }
  compareViewSessions.dispatch(context.side, {
    type: "focus.activate",
    objectRef: compareViewSessions.objectRef(context.side, "cell", nodeId)
  });
  const node = context.graph?.nodes.find((item) => item.id === nodeId);
  if (node) {
    const mount = context.side === "left" ? elements.leftMount : elements.rightMount;
    focusPositionedCell(node, mount, state.compare.transforms[context.side], (transform) => {
      setCompareTransform(context.side, transform);
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
    const netName = focusedNetName(nodeId);
    const node = context.fullGraph?.nodes.find((item) => item.id === nodeId);
    const localLabel = netName ? `net ${netName}` : node?.label || nodeId.replace(/^cell:/, "");
    const occurrencePath = node?.ref?.occurrencePath?.join("/") || "";
    const label = occurrencePath ? `${occurrencePath} · ${localLabel}` : localLabel;
    const activeClass = nodeId === context.activeRootNodeId ? " is-active" : "";
    const title = `${context.compare ? `${context.side}: ` : ""}${occurrencePath ? `${occurrencePath} / ` : ""}${localLabel}`;
    return `<span class="focused-root-chip${activeClass}" title="${escapeAttr(title)}" data-focused-root-activate="${escapeAttr(nodeId)}"><span>${context.compare ? `${escapeHtml(context.side)}: ` : ""}${escapeHtml(label)}</span><button type="button" aria-label="Remove ${escapeAttr(label)} from Focused roots" data-focused-root-remove="${escapeAttr(nodeId)}">×</button></span>`;
  }).join("");
}

function updateFocusSelectedControl() {
  const singleCell = !state.compare.active && state.fullGraph?.nodes.some(
    (node) => node.id === state.selectedNodeId && node.kind === "cell"
  );
  const singleNet = !state.compare.active && Boolean(state.selectedNet);
  const compareCell = state.compare.active && state.compare.selectedKind === "cell" && Boolean(state.compare.selectedName);
  const compareNet = state.compare.active && state.compare.selectedKind === "net" && Boolean(state.compare.selectedName);
  elements.focusSelectedButton.disabled = !(singleCell || singleNet || compareCell || compareNet);
}

function handleFocusSelectedShortcut(event) {
  if (event.key.toLowerCase() !== "f" || event.altKey || event.ctrlKey || event.metaKey || isEditableInputTarget(event.target)) return;
  if (elements.focusSelectedButton.disabled) return;
  event.preventDefault();
  focusSelectedCell();
}

function focusSelectedCell() {
  if (state.compare.active) {
    if (state.compare.selectedKind === "net" && state.compare.selectedName) {
      const side = state.compare.selectedSide || "left";
      const graph = state.compare.graphs[side];
      const edge = graph?.edges.find((item) => item.net === state.compare.selectedName);
      const mount = side === "left" ? elements.leftMount : elements.rightMount;
      if (edge) {
        focusPositionedEdge(edge, mount, state.compare.transforms[side], (transform) => setCompareTransform(side, transform));
        applyCompareTransforms();
      }
      recordViewHistory();
      setStatus(`Focused compare net ${state.compare.selectedName}`);
      return;
    }
    focusSelectedCompareCell();
    return;
  }
  if (state.selectedNet) {
    const edge = state.graph?.edges.find((item) => item.net === state.selectedNet);
    if (edge) {
      focusPositionedEdge(edge, elements.mount, state.transform, setSingleTransform);
      applyTransform();
      setStatus(`Focused net ${state.selectedNet}`);
      recordViewHistory();
    }
    return;
  }
  const selectedNodeId = state.selectedNodeId;
  const fullNode = state.fullGraph?.nodes.find((node) => node.id === selectedNodeId && node.kind === "cell");
  if (!fullNode) return;
  const positioned = state.graph?.nodes.find((node) => node.id === selectedNodeId);
  if (positioned) {
    focusPositionedCell(positioned, elements.mount, state.transform, setSingleTransform);
    applyTransform();
    setStatus(`Focused ${fullNode.label}`);
    recordViewHistory();
    return;
  }

  const requestId = ++state.selectionFocusRequestId;
  singleViewSession.dispatch({
    type: "focus.set",
    objectRef: singleViewSession.objectRefForNode(fullNode)
  });
  renderCurrentModuleGraph({
    onRendered: (graph) => {
      if (requestId !== state.selectionFocusRequestId || state.selectedNodeId !== selectedNodeId) return;
      const node = graph.nodes.find((item) => item.id === selectedNodeId);
      if (!node) return;
      focusPositionedCell(node, elements.mount, state.transform, setSingleTransform);
      setSelectedNode(selectedNodeId, false);
      applyTransform();
      recordViewHistory();
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
  replaceSingleFocusedRoots(rootNodeIds, nodeId);
  setSelectedNode(nodeId);
  setSingleTransform({ x: 0, y: 0, scale: 1 });
  updateViewControls();
  return new Promise((resolve) => {
    renderCurrentModuleGraph({
      onRendered: (graph) => {
        const positioned = graph.nodes.find((item) => item.id === nodeId);
        setSelectedNode(positioned?.id || null);
        if (positioned) {
          focusPositionedCell(positioned, elements.mount, state.transform, setSingleTransform);
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
      setCompareTransform(side, transform);
    });
  }
  applyCompareTransforms();
  recordViewHistory();
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

function focusPositionedEdge(edge, mount, currentTransform, commit) {
  const point = getEdgeCenter(edge);
  const svg = mount.querySelector("svg");
  if (!point || !svg) return;
  const viewport = svg.getBoundingClientRect();
  commit(getFocusedObjectTransform({
    viewBox: svg.viewBox.baseVal,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    bounds: { x: point.x - 50, y: point.y - 18, width: 100, height: 36 },
    targetPixels: 260,
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
  setSingleLayoutPolicy(normalizeLayoutPolicy({
    ...state.layoutPolicy,
    spacing: { ...state.layoutPolicy.spacing, [key]: value }
  }));
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
      setSingleTransform(previousTransform);
      setSelectedNode(selectedNodeId);
      applyTransform();
    }
    setStatus(`Cell spacing: ${value}px`);
    return;
  }

  const previousTransform = { ...state.transform };
  renderCurrentModuleGraph();
  setSingleTransform(previousTransform);
  renderStats();
  renderDiagnostics();
  const selectedNode = state.selectedNodeId;
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
    singleViewSession.dispatch({
      type: "presentation.policy.set",
      presentationPolicy
    });
  }
  if (state.compare.active) {
    for (const side of ["left", "right"]) {
      compareViewSessions.dispatch(side, {
        type: "presentation.policy.set",
        presentationPolicy
      });
    }
    refreshComparePresentationScenes();
  } else if (state.graph) {
    state.scene = createNetlistScene(state.graph, { presentationPolicy });
    renderGraphMount(elements.mount, state.graph, { scene: state.scene }).then((result) => {
      if (result?.cancelled) return;
      applyTransform();
      updateCalibrationControls();
    });
  }
  persistSession();
  setStatus(`Gate symbols: ${presentationPolicy.gateSymbolMode}`);
}

function refreshComparePresentationScenes() {
  const renders = [];
  for (const side of ["left", "right"]) {
    const graph = state.compare.graphs[side];
    if (!graph) continue;
    const scene = createNetlistScene(graph, { presentationPolicy: state.presentationPolicy });
    state.compare.scenes[side] = scene;
    const mount = side === "left" ? elements.leftMount : elements.rightMount;
    renders.push(renderGraphMount(mount, graph, { scene }));
  }
  Promise.all(renders).then((results) => {
    if (results.some((result) => result?.cancelled)) return;
    applyCompareHighlights();
    applyCompareTransforms();
    updateCalibrationControls();
  });
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
    if (refreshView.viewMode === "focused" || refreshView.viewMode === "search-first") {
      replaceSingleFocusedRoots(refreshView.rootNodeIds ||
        (refreshView.coneRootNodeId ? [refreshView.coneRootNodeId] : []));
      if (refreshView.viewMode === "search-first") setSingleViewMode("search-first");
    } else {
      singleViewSession.dispatch({ type: "focus.clear" });
    }
    renderCurrentModuleGraph({
      readyMessage: message,
      onRendered: (graph) => {
        setSingleTransform(previousTransform);
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

function setSelectedNode(nodeId, shouldRecord = true) {
  state.selectionFocusRequestId += 1;
  schematicSelectionController.selectNode(nodeId);
  if (shouldRecord) recordViewHistory();
}

function setSelectedNet(netName, shouldRecord = true) {
  state.selectionFocusRequestId += 1;
  schematicSelectionController.selectNet(netName);
  if (shouldRecord) recordViewHistory();
}

function clearSchematicSelection() {
  schematicSelectionController.clearDomSelection();
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

  if (target.kind === "net") {
    setSelectedNet(target.name);
    setStatus("Connected net is outside the current Focused view");
    return;
  }

  const fullNode = state.fullGraph?.nodes.find((node) => node.id === target.id);
  if (state.viewMode !== "focused" || fullNode?.kind !== "cell") {
    setStatus("Connected node is outside the current view; use Whole to reveal it");
    return;
  }

  const reveal = singleViewSession.dispatch({
    type: "selection.reveal",
    objectRef: singleViewSession.objectRefForNode(fullNode),
    visibleObjectKeys: singleViewSession.visibleObjectKeys(),
    replaceActiveWhenFull: true
  });
  if (reveal.rejected) {
    setStatus("Connected cell could not be added to the current Focused roots");
    return;
  }
  updateViewControls();
  setStatus("Opening connected cell in Focused view…");
  renderCurrentModuleGraph({
    onRendered: (graph) => {
      const node = graph.nodes.find((item) => item.id === fullNode.id);
      setSelectedNode(node?.id || null);
      if (!node) {
        setStatus("Connected cell is inside a collapsed group; expand the group to reveal it");
        return;
      }
      centerGraphPoint({
        x: node.x + node.width / 2,
        y: node.y + node.height / 2
      }, node.width);
      setStatus(`Focused connected cell: ${node.label}`);
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
    if (edge) {
      setSelectedNet(target.name, false);
      centerGraphPoint(getEdgeCenter(edge));
      recordViewHistory();
      setStatus(`Search: net ${result.label}`);
      return;
    }
    const fullEdge = state.fullGraph?.edges.find((item) => item.net === target.name);
    if (fullEdge) {
      revealSearchTarget(result.objectRef || singleViewSession.objectRefForNet(target.name), () => {
        const positioned = state.graph?.edges.find((item) => item.net === target.name);
        setSelectedNet(target.name, false);
        if (positioned) centerGraphPoint(getEdgeCenter(positioned));
        recordViewHistory();
        setStatus(`Focused search net ${result.label}`);
      });
      return;
    }
    setSelectedNet(target.name);
    setStatus(`Search: net ${result.label} (not positioned)`);
    return;
  }

  const fullNode = findSearchTargetNode(target, state.fullGraph);
  if (target.kind === "cell" && fullNode) {
    const positioned = state.graph?.nodes.find((node) => node.id === fullNode.id);
    if (positioned) {
      singleViewSession.dispatch({
        type: "selection.set",
        objectRef: result.objectRef || singleViewSession.objectRefForNode(fullNode)
      });
      setSelectedNode(positioned.id, false);
      centerGraphPoint({ x: positioned.x + positioned.width / 2, y: positioned.y + positioned.height / 2 }, positioned.width);
      recordViewHistory();
      setStatus(`Search: ${result.kind} ${result.label}`);
      return;
    }
    revealSearchTarget(result.objectRef || singleViewSession.objectRefForNode(fullNode), () => {
      const positioned = state.graph?.nodes.find((node) => node.id === fullNode.id);
      setSelectedNode(positioned?.id || null, false);
      if (positioned) centerGraphPoint({ x: positioned.x + positioned.width / 2, y: positioned.y + positioned.height / 2 }, positioned.width);
      recordViewHistory();
      setStatus(`Focused ${result.label}: fanin ${state.faninDepth}, fanout ${state.fanoutDepth}`);
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

function revealSearchTarget(objectRef, onRendered) {
  const reveal = singleViewSession.dispatch({
    type: "selection.reveal",
    objectRef,
    visibleObjectKeys: singleViewSession.visibleObjectKeys()
  });
  if (reveal.rejected) {
    setStatus("Search target could not be added to Focused roots");
    return;
  }
  if (!reveal.effects.layout) {
    onRendered?.(state.graph);
    return;
  }
  setSingleTransform({ x: 0, y: 0, scale: 1 });
  renderCurrentModuleGraph({ onRendered });
}

function addSearchResultToFocus(result) {
  if (!result || !["cell", "net"].includes(result.target?.kind)) return;
  if (state.currentModule?.name !== result.moduleName) {
    selectModule(result.moduleName, { onRendered: () => addSearchResultToFocus(result) });
    return;
  }
  const fullNode = result.target.kind === "cell"
    ? findSearchTargetNode(result.target, state.fullGraph)
    : null;
  const fullEdge = result.target.kind === "net"
    ? state.fullGraph?.edges.find((edge) => edge.net === result.target.name)
    : null;
  if (!fullNode && !fullEdge) return;
  elements.searchResults.hidden = true;
  const action = singleViewSession.dispatch({
    type: "focus.add",
    objectRef: result.objectRef || (fullNode
      ? singleViewSession.objectRefForNode(fullNode)
      : singleViewSession.objectRefForNet(result.target.name))
  });
  if (action.rejected) { setStatus("Focused root limit reached"); return; }
  if (!action.effects.layout) {
    if (fullNode) setSelectedNode(fullNode.id);
    else setSelectedNet(result.target.name);
    setStatus(`${result.label} is already a Focused root`);
    return;
  }
  setSingleTransform({ x: 0, y: 0, scale: 1 });
  renderCurrentModuleGraph({
    onRendered: (graph) => {
      const node = fullNode ? graph.nodes.find((item) => item.id === fullNode.id) : null;
      const edge = fullEdge ? graph.edges.find((item) => item.net === result.target.name) : null;
      if (node) {
        setSelectedNode(node.id, false);
        centerGraphPoint({ x: node.x + node.width / 2, y: node.y + node.height / 2 }, node.width);
      } else if (edge) {
        setSelectedNet(result.target.name, false);
        centerGraphPoint(getEdgeCenter(edge));
      }
      recordViewHistory();
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
  setSingleTransform({
    x: viewBox.width / 2 - point.x * scale,
    y: viewBox.height / 2 - point.y * scale,
    scale
  });
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
  if (!selectedSide) return;
  const peerSide = selectedSide === "left" ? "right" : "left";
  if (compareObjectExists(peerSide, kind, name)) {
    compareViewSessions.dispatch(peerSide, {
      type: "selection.set",
      objectRef: compareViewSessions.objectRef(peerSide, kind, name)
    });
  }
  compareViewSessions.dispatch(selectedSide, {
    type: "selection.set",
    objectRef: compareViewSessions.objectRef(selectedSide, kind, name)
  });
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
      recordViewHistory();
      return;
    }
  }
  elements.details.className = "details-block";
  elements.details.innerHTML = statsRows([["Compare object", name], ["Kind", kind], ["Present", "highlighted on both sides where available"]]);
  recordViewHistory();
}

function clearCompareSelection() {
  for (const side of ["left", "right"]) {
    compareViewSessions.dispatch(side, { type: "selection.clear" });
  }
}

function compareObjectExists(side, kind, name) {
  if (kind === "net") return Boolean(state.compare.graphs?.[side]?.edges?.some((edge) => edge.net === name));
  return Boolean(findCompareNode(state.compare.graphs?.[side], kind, name));
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
      updateCompareOverrides(side, (overrides) => overrides.nodeSizes.set(node.id, {
        width: clamp(Number(size.width), 24, 420),
        height: clamp(Number(size.height), 12, 260)
      }));
      renderCompareGraphs();
    },
    onResetSize: () => {
      updateCompareOverrides(side, (overrides) => overrides.nodeSizes.delete(node.id));
      renderCompareGraphs();
    },
    onPropertyChange: (property, value) => {
      if (!isEditableNodeProperty(property)) return;
      const trimmed = String(value ?? "").trim();
      updateCompareOverrides(side, (snapshot) => {
        const overrides = snapshot.graphOverrides.nodeProperties;
        overrides[node.id] ||= {};
        if (trimmed) overrides[node.id][property] = trimmed;
        else delete overrides[node.id][property];
        if (Object.keys(overrides[node.id]).length === 0) delete overrides[node.id];
      });
      renderCompareGraphs();
    },
    onResetProperties: () => {
      updateCompareOverrides(side, (overrides) => delete overrides.graphOverrides.nodeProperties[node.id]);
      renderCompareGraphs();
    },
    onPinDirectionChange: (pin, direction) => {
      if (!instance) return;
      updateCompareOverrides(side, (overrides) => {
        const pins = overrides.graphOverrides.cellPinDirections[instance] ||= {};
        pins[pin] = direction;
      });
      renderCompareGraphs();
    },
    onResetPinDirections: () => {
      if (instance) updateCompareOverrides(side, (overrides) => delete overrides.graphOverrides.cellPinDirections[instance]);
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
    setCompareTransform(side, {
      x: svg.viewBox.baseVal.width / 2 - point.x * scale,
      y: svg.viewBox.baseVal.height / 2 - point.y * scale,
      scale
    }, false);
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
    ...(state.compare.active ? [] : (state.graph?.diagnostics || [])),
    ...(state.compare.active ? (state.compare.graphs?.left?.diagnostics || []) : []),
    ...(state.compare.active ? (state.compare.graphs?.right?.diagnostics || []) : [])
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
      updateSingleOverrides((overrides) => overrides.nodeSizes.delete(node.id));
      rerenderPreservingView(node.id);
      setStatus(`${node.label}: size reset`);
    },
    onPropertyChange: (property, value) => updateNodeProperty(node.id, property, value),
    onResetProperties: () => {
      updateSingleOverrides((overrides) => delete overrides.graphOverrides.nodeProperties[node.id]);
      rerenderPreservingView(node.id);
      setStatus(`${node.label}: properties reset`);
    },
    onPinDirectionChange: (pin, direction) => updateCellPinDirection(node, pin, direction),
    onResetPinDirections: () => {
      if (instance) {
        updateSingleOverrides((overrides) => delete overrides.graphOverrides.cellPinDirections[instance]);
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

  updateSingleOverrides((overrides) => overrides.nodeSizes.set(nodeId, nextSize));
  rerenderPreservingView(nodeId);
  setStatus(`${node.label}: width=${nextSize.width}, height=${nextSize.height}`);
}

function updateNodeProperty(nodeId, property, value) {
  const node = state.graph?.nodes.find((item) => item.id === nodeId);
  if (!node || !isEditableNodeProperty(property)) {
    return;
  }
  const trimmed = String(value ?? "").trim();
  updateSingleOverrides((overrides) => {
    const properties = overrides.graphOverrides.nodeProperties[nodeId] ||= {};
    if (trimmed === "") delete properties[property];
    else properties[property] = trimmed;
    if (Object.keys(properties).length === 0) delete overrides.graphOverrides.nodeProperties[nodeId];
  });
  rerenderPreservingView(nodeId);
  setStatus(`${node.label}: ${property} updated`);
}

function updateCellPinDirection(node, pinName, direction) {
  const instance = getNodeInstance(node);
  if (!instance || (direction !== "input" && direction !== "output")) {
    return;
  }
  updateSingleOverrides((overrides) => {
    const pins = overrides.graphOverrides.cellPinDirections[instance] ||= {};
    pins[pinName] = direction;
  });
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
  setSingleTransform(previousTransform);
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
      replaceSingleFocusedRoots(nextRoots,
        nextRoots.includes(clickedNode.id) ? clickedNode.id : null);
      setSingleTransform({ x: 0, y: 0, scale: 1 });
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
      setSingleTransform(transform);
      applyTransform(false);
    },
    onEnd({ didPan, cancelled }) {
      if (didPan && !cancelled) persistSession();
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
        setStatus(`${node.label}: snapped ${snap.net} to y=${snap.targetY}`);
      } else {
        setStatus(`${node.label}: x=${position.x}, y=${position.y}`);
      }
    },
    onCommit({ preview }) {
      updateSingleOverrides((overrides) => overrides.nodePositions.set(nodeId, draggedPosition));
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
  state.scene = createNetlistScene(state.graph, { presentationPolicy: state.presentationPolicy });
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
    setCompareTransform("left", { x: 0, y: 0, scale: 1 }, false);
    setCompareTransform("right", { x: 0, y: 0, scale: 1 }, false);
    applyCompareTransforms();
    setStatus("Fit both compare views");
    recordViewHistory();
    return;
  }
  setSingleTransform({ x: 0, y: 0, scale: 1 });
  applyTransform();
  recordViewHistory();
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
    for (const side of ["left", "right"]) {
      setCompareOverrides(side, {
        nodePositions: new Map(),
        nodeSizes: new Map(),
        graphOverrides: createEmptyGraphOverrides()
      });
    }
    renderCompareGraphs();
    updateCalibrationControls();
    setStatus("Compare Adjust overrides cleared");
    return;
  }
  if (state.nodePositions.size === 0 && state.nodeSizes.size === 0 && countGraphOverrides() === 0) {
    return;
  }

  const selectedNode = state.selectedNodeId;
  setSingleOverrides({
    nodePositions: new Map(),
    nodeSizes: new Map(),
    graphOverrides: createEmptyGraphOverrides()
  });
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
  setSingleOverrides({
    nodePositions: state.nodePositions,
    nodeSizes: state.nodeSizes,
    graphOverrides: state.graphOverrides
  });
  setSingleLayoutPolicy(state.layoutPolicy);

  elements.coneDepthInput.value = String(state.coneDepth);
  elements.faninDepthInput.value = String(state.faninDepth);
  elements.fanoutDepthInput.value = String(state.fanoutDepth);
  syncLayoutSpacingControls();
  setSingleTransform({ x: 0, y: 0, scale: 1 });
  setSelectedNode(null);
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
        faninDepth: state.faninDepth,
        fanoutDepth: state.fanoutDepth,
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

function setSingleTransform(transform) {
  if (!state.document?.documentId || !state.currentModule?.name) {
    state.transform = { ...transform };
    return state.transform;
  }
  return singleViewSession.dispatch({
    type: "viewport.set",
    viewport: transform
  }).session.viewport;
}

function setSingleLayoutPolicy(layoutPolicy) {
  const normalized = normalizeLayoutPolicy(layoutPolicy);
  if (!state.document?.documentId || !state.currentModule?.name) {
    state.layoutPolicy = normalized;
    return state.layoutPolicy;
  }
  singleViewSession.dispatch({ type: "layout.policy.set", layoutPolicy: normalized });
  return state.layoutPolicy;
}

function setSingleViewMode(viewMode) {
  const normalized = normalizeSingleViewMode(viewMode);
  if (!state.document?.documentId || !state.currentModule?.name) {
    state.viewMode = normalized;
    recordViewHistory();
    return { rejected: null };
  }
  const result = singleViewSession.dispatch({ type: "view.mode.set", viewMode: normalized });
  recordViewHistory();
  return result;
}

function setSingleFocusedDepths(faninDepth, fanoutDepth) {
  if (!state.document?.documentId || !state.currentModule?.name) {
    state.faninDepth = faninDepth;
    state.fanoutDepth = fanoutDepth;
    recordViewHistory();
    return null;
  }
  const result = singleViewSession.dispatch({ type: "view.depths.set", faninDepth, fanoutDepth });
  recordViewHistory();
  return result;
}

function replaceSingleFocusedRoots(nodeIds, activeNodeId = null) {
  if (!state.document?.documentId || !state.currentModule?.name) {
    setFocusedRootNodeIds(state, nodeIds, activeNodeId);
    recordViewHistory();
    return null;
  }
  const nodes = (nodeIds || []).map((nodeId) =>
    state.fullGraph?.nodes.find((node) => node.id === nodeId)
  ).filter(Boolean);
  const activeNode = nodes.find((node) => node.id === activeNodeId) || nodes[0] || null;
  const result = singleViewSession.dispatch({
    type: "focus.replace",
    objectRefs: nodes.map((node) => singleViewSession.objectRefForNode(node)),
    activeObjectRef: activeNode ? singleViewSession.objectRefForNode(activeNode) : null
  });
  recordViewHistory();
  return result;
}

function setSingleOverrides(overrides) {
  if (!state.document?.documentId || !state.currentModule?.name) {
    state.nodePositions = new Map(overrides?.nodePositions || []);
    state.nodeSizes = new Map(overrides?.nodeSizes || []);
    state.graphOverrides = overrides?.graphOverrides || createEmptyGraphOverrides();
    recordViewHistory();
    return;
  }
  singleViewSession.dispatch({ type: "overrides.set", overrides });
  recordViewHistory();
}

function updateSingleOverrides(update) {
  const overrides = {
    nodePositions: new Map(state.nodePositions),
    nodeSizes: new Map(state.nodeSizes),
    graphOverrides: {
      nodeProperties: Object.fromEntries(Object.entries(state.graphOverrides.nodeProperties).map(([id, value]) => [id, { ...value }])),
      cellPinDirections: Object.fromEntries(Object.entries(state.graphOverrides.cellPinDirections).map(([id, value]) => [id, { ...value }]))
    }
  };
  update(overrides);
  setSingleOverrides(overrides);
}

function setCompareOverrides(side, overrides) {
  compareViewSessions.dispatch(side, { type: "overrides.set", overrides });
  // A Compare-side move/resize is one user operation; capture both side state
  // and the owning side override after the command has committed.
  recordViewHistory();
}

function updateCompareOverrides(side, update) {
  const overrides = {
    nodePositions: new Map(state.compare.nodePositions[side]),
    nodeSizes: new Map(state.compare.nodeSizes[side]),
    graphOverrides: {
      nodeProperties: Object.fromEntries(Object.entries(state.compare.graphOverrides[side].nodeProperties).map(([id, value]) => [id, { ...value }])),
      cellPinDirections: Object.fromEntries(Object.entries(state.compare.graphOverrides[side].cellPinDirections).map(([id, value]) => [id, { ...value }]))
    }
  };
  update(overrides);
  setCompareOverrides(side, overrides);
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
    commit: (transform) => setCompareTransform(side, transform),
    onEnd({ didPan, cancelled }) {
      if (didPan && !cancelled) persistSession();
    }
  });
}

function toggleCompareFocusedRoot(side, nodeId) {
  const roots = normalizeFocusedSelectionRoots(state.compare.focusedRootNodeIds?.[side]);
  const nextRoots = toggleFocusedRootNodeId(roots, nodeId);
  setCompareFocusedRootNodeIds(side, nextRoots, nextRoots.includes(nodeId) ? nodeId : null);
  const matchedNode = syncCompareFocusedRootNode(side, nodeId, nextRoots.includes(nodeId) ? "add" : "remove");
  setCompareTransform(side, { x: 0, y: 0, scale: 1 });
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
      updateCompareOverrides(side, (overrides) => overrides.nodePositions.set(node.id, draggedPosition));
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
  setSingleTransform(getSteppedZoomedTransform(
    state.transform,
    point,
    sample.steps,
    svg.viewBox.baseVal.width,
    rect.width,
    0.25,
    svg.viewBox.baseVal.height,
    rect.height
  ));
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
  state.compare.scenes[side] = createNetlistScene(graph, { presentationPolicy: state.presentationPolicy });
  const mount = side === "left" ? elements.leftMount : elements.rightMount;
  return renderGraphMount(mount, graph, { ...renderOptions, scene: state.compare.scenes[side] }).then((result) => {
    if (result?.cancelled) return result;
    applyCompareHighlights();
    applyCompareTransforms();
    updateCalibrationControls();
    return result;
  });
}

function setCompareTransform(side, transform, synchronize = state.compare.synchronized) {
  compareViewSessions.dispatch(side, { type: "viewport.set", viewport: transform });
  if (synchronize) {
    compareViewSessions.dispatch(side === "left" ? "right" : "left", {
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
    state.presentationPolicy = normalizeNetlistPresentationPolicy(session.presentationPolicy);
    if (session.layoutPolicy) setSingleLayoutPolicy(session.layoutPolicy);
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
  elements.gateSymbolModeSelect.value = state.presentationPolicy.gateSymbolMode;
  syncLayoutSpacingControls();
  timingDisplayController.sync();
}

function syncLayoutSpacingControls() {
  layoutSpacingController.sync();
}

function persistSession() {
  if (!state.currentSource) return;
  recordViewHistory();
  clearTimeout(sessionSaveTimer);
  sessionSaveTimer = setTimeout(() => saveSessionState(createSessionSnapshot(state)), 150);
}

function recordViewHistory() {
  if (!state.currentSource || !state.currentModule || state.restoringViewHistory) return;
  state.viewHistory = pushViewHistory(state.viewHistory, createViewHistoryEntry(state));
  updateModuleHistoryControls();
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
