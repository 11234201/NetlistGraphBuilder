import { inspectGraphNet, inspectGraphNode } from "../analysis/graphInspector.js";
import { recommendModulePair } from "../analysis/moduleCompare.js";
import {
  compareLayoutGraphs,
  createLayoutGolden,
  getLayoutGoldenState
} from "../layout/layoutGolden.js";
import { DEFAULT_LAYOUT_POLICY, normalizeLayoutPolicy } from "../layout/layoutPolicy.js";
import { getLayoutProvider, listLayoutProviders } from "../layout/layoutProvider.js";
import { snapNodePosition } from "../layout/snap.js";
import { renderSchematicSvg } from "../render/svgRenderer.js";
import { renderSchematicIntoMount } from "../render/progressiveSvgRenderer.js";
import { createStandaloneSvg } from "../render/svgExport.js";
import {
  buildDesignSearchIndex,
  searchDesignIndex
} from "../search/designSearch.js";
import { parseTimingLog } from "../timing/timingParser.js";
import {
  createEmptyCellConfig,
  loadStoredCellConfig,
  mergeCellConfigs,
  parseCellConfig,
  removeCellConfigDefinition,
  saveStoredCellConfig,
  serializeCellConfig,
  setCellConfigDefinition
} from "../infer/cellConfig.js";
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
import { getDraggedNodePosition, sameNodePosition } from "../ui/nodeDrag.js";
import { createNodeDragPreview } from "../ui/nodeDragPreview.js";
import { createLatestFrameScheduler } from "../ui/frameScheduler.js";
import { hasPointerDragged } from "../ui/pointerGesture.js";
import { startPointerSession } from "../ui/pointerSession.js";
import {
  clientPointToViewBox,
  formatViewportTransform,
  getAdaptiveMaxScale,
  getFocusedObjectTransform,
  getPannedTransform,
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
  restoreCompareWorkspace,
  restoreModuleWorkspace,
  resetDesignWorkspace,
  resetTimingPresentation,
  saveCompareWorkspace,
  saveModuleWorkspace
} from "./appState.js";
import { sampleNetlist } from "./sampleNetlist.js";
import { createSessionSnapshot, loadSessionState, saveSessionState } from "./sessionState.js";
import { normalizeSingleViewMode } from "./singleViewMode.js";
import { resolveFocusedRootTarget } from "./focusedSelection.js";
import {
  buildCompareWorkspace,
  findCompareNode,
  getCompareNodeName
} from "./compareWorkspace.js";
import { buildModuleWorkspace } from "./moduleWorkspace.js";
import { applyWorkspaceOverrides } from "./layoutWorkspace.js";
import { parseDesignSource } from "./designInput.js";
import {
  applyLayoutGoldenState,
  resolveLayoutGoldenModule
} from "./layoutGoldenImport.js";
import {
  detectQuickInputKind,
  getQuickInputPriority
} from "./quickInput.js";
import { findReferencedModule } from "./moduleNavigation.js";
import { resolveCellConfigRefreshView, shouldUseSearchFirst } from "./graphWorkspace.js";
import { createProcessLog } from "./processLog.js";
import { renderProcessLogEntries } from "../ui/processLogPanel.js";
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
state.cellConfig = loadStoredCellConfig();
const processLog = createProcessLog({ capacity: 500 });
const SEARCH_FIRST_NODE_THRESHOLD = 500;
let sessionSaveTimer = null;
let fileDragDepth = 0;
let pendingWheelGesture = null;
let focusedDepthChangeTimer = null;
let wheelInteractionTimer = null;
let textInputKind = "netlist";
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
  focusSelectedButton: document.querySelector("#focusSelectedButton"),
  wireSpacingInput: document.querySelector("#wireSpacingInput"),
  wireSpacingValue: document.querySelector("#wireSpacingValue"),
  cellSpacingInput: document.querySelector("#cellSpacingInput"),
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
const wheelFrames = createLatestFrameScheduler(applyPendingWheelGesture);
const toolbarMenus = [...document.querySelectorAll(".toolbar-menu")];

elements.fileInput.addEventListener("change", handleFileChange);
elements.pasteNetlistButton.addEventListener("click", () => openTextInputDialog("netlist"));
elements.pasteTimingButton.addEventListener("click", () => openTextInputDialog("timing"));
elements.netlistTextForm.addEventListener("submit", handleNetlistTextSubmit);
elements.netlistTextInput.addEventListener("keydown", handleNetlistTextKeydown);
elements.closeNetlistTextButton.addEventListener("click", closeNetlistTextDialog);
elements.cancelNetlistTextButton.addEventListener("click", closeNetlistTextDialog);
elements.timingInput.addEventListener("change", handleTimingFileChange);
elements.goldenInput.addEventListener("change", handleGoldenFileChange);
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
elements.compareLayoutSelect.addEventListener("change", (event) => {
  state.compare.layout = event.target.value === "horizontal" ? "horizontal" : "vertical";
  applyCompareLayout();
  fitToView();
});
elements.compareOutputSelect.addEventListener("change", (event) => {
  state.compare.outputName = event.target.value || null;
  elements.coneDepthInput.disabled = !state.compare.outputName;
  renderCompareGraphs();
  renderStats();
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
elements.focusSelectedButton.addEventListener("click", focusSelectedCell);
elements.wireSpacingInput.addEventListener("input", handleWireSpacingChange);
elements.cellSpacingInput.addEventListener("input", handleCellSpacingChange);
elements.timingSnapshotSelect.addEventListener("change", handleTimingDisplayPolicyChange);
elements.timingMetricSelect.addEventListener("change", handleTimingDisplayPolicyChange);
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
elements.toggleProcessLogButton.addEventListener("click", () => toggleProcessLogDrawer());
elements.processLogLevelFilter.addEventListener("change", renderProcessLog);
elements.processLogPhaseFilter.addEventListener("change", renderProcessLog);
elements.copyProcessLogButton.addEventListener("click", copyProcessLog);
elements.exportProcessLogButton.addEventListener("click", exportProcessLog);
elements.clearProcessLogButton.addEventListener("click", clearProcessLog);
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
window.addEventListener("dragenter", handleWindowDragEnter);
window.addEventListener("dragover", handleWindowDragOver);
window.addEventListener("dragleave", handleWindowDragLeave);
window.addEventListener("drop", handleWindowDrop);
window.addEventListener("dragend", clearFileDragState);
window.addEventListener("paste", handleGlobalPaste);
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

async function handleFileChange(event) {
  await handleInputFileChange(event, "netlist");
}

function openTextInputDialog(kind) {
  textInputKind = kind === "timing" ? "timing" : "netlist";
  const timingMode = textInputKind === "timing";
  elements.netlistTextTitle.textContent = timingMode ? "Paste timing" : "Paste Verilog";
  elements.netlistTextDescription.textContent = timingMode
    ? "粘贴 Global/Local 表格或 LocResyn timing，解析成功后应用到当前设计。"
    : "粘贴 structural Verilog，解析成功后立即画图。";
  if (!elements.netlistTextDialog.open) elements.netlistTextDialog.showModal();
  requestAnimationFrame(() => elements.netlistTextInput.focus());
}

function closeNetlistTextDialog() {
  if (elements.netlistTextDialog.open) elements.netlistTextDialog.close();
}

function handleNetlistTextKeydown(event) {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    elements.netlistTextForm.requestSubmit();
  }
}

function handleNetlistTextSubmit(event) {
  event.preventDefault();
  const source = elements.netlistTextInput.value.trim();
  if (!source) {
    setStatus(`Paste failed: ${textInputKind} text is empty`);
    elements.netlistTextInput.focus();
    return;
  }
  try {
    loadQuickInputText(source, {
      kind: textInputKind,
      label: textInputKind === "timing" ? "pasted timing" : "pasted Verilog"
    });
    closeNetlistTextDialog();
  } catch {
    elements.netlistTextInput.focus();
  }
}

async function handleGoldenFileChange(event) {
  await handleInputFileChange(event, "golden");
}

async function handleTimingFileChange(event) {
  await handleInputFileChange(event, "timing");
}

async function handleInputFileChange(event, preferredKind) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    await loadQuickInputFile(file, preferredKind);
  } catch (error) {
    setStatus(`Load failed ${file.name}: ${error.message}`);
  } finally {
    event.target.value = "";
  }
}

async function loadQuickInputFile(file, preferredKind = null) {
  const text = await file.text();
  const kind = detectQuickInputKind(text, { name: file.name, preferredKind });
  loadQuickInputText(text, { kind, label: file.name });
}

function loadQuickInputText(text, options = {}) {
  const kind = options.kind || detectQuickInputKind(text, { name: options.name });
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
  let timing;
  try {
    timing = parseTimingLog(text);
  } catch (error) {
    logProcess("error", "timing", `Timing parse failed: ${error.message}`, { label });
    throw error;
  }
  if ((timing.scopeCount || timing.instanceCount || 0) === 0) {
    throw new Error("no timing scope or instance record was recognized");
  }
  state.timing = timing;
  logProcess("info", "timing", `Loaded ${timing.scopeCount || timing.instanceCount} timing scope(s)`, {
    label,
    format: timing.format,
    diagnostics: timing.diagnostics?.length || 0
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

function handleWindowDragEnter(event) {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  fileDragDepth += 1;
  showFileDropOverlay();
}

function handleWindowDragOver(event) {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  showFileDropOverlay();
}

function handleWindowDragLeave(event) {
  if (fileDragDepth === 0) return;
  fileDragDepth = Math.max(0, fileDragDepth - 1);
  if (fileDragDepth === 0) clearFileDragState();
}

function handleWindowDrop(event) {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  const files = Array.from(event.dataTransfer?.files || []);
  clearFileDragState();
  if (files.length === 0) return;
  loadDroppedFiles(files).catch((error) => setStatus(`Drop failed: ${error.message}`));
}

async function loadDroppedFiles(files) {
  const entries = await Promise.all(files.map(async (file, order) => {
    const text = await file.text();
    const kind = detectQuickInputKind(text, { name: file.name });
    return { file, text, kind, order };
  }));
  entries.sort((left, right) =>
    getQuickInputPriority(left.kind) - getQuickInputPriority(right.kind) || left.order - right.order);
  for (const entry of entries) {
    loadQuickInputText(entry.text, { kind: entry.kind, label: entry.file.name });
  }
}

function handleGlobalPaste(event) {
  if (elements.netlistTextDialog.open || isEditablePasteTarget(event.target)) return;
  const files = Array.from(event.clipboardData?.files || []);
  if (files.length > 0) {
    event.preventDefault();
    loadDroppedFiles(files).catch((error) => setStatus(`Paste failed: ${error.message}`));
    return;
  }

  const text = event.clipboardData?.getData("text/plain") || "";
  if (!text.trim()) return;
  let kind;
  try {
    kind = detectQuickInputKind(text);
  } catch {
    return;
  }
  event.preventDefault();
  const label = kind === "netlist"
    ? "pasted Verilog"
    : kind === "golden" ? "pasted Golden" : "pasted timing";
  try {
    loadQuickInputText(text, { kind, label });
  } catch (error) {
    setStatus(`Paste failed: ${error.message}`);
  }
}

function showFileDropOverlay() {
  document.body.classList.add("is-dragging-files");
  elements.dropOverlay.setAttribute("aria-hidden", "false");
}

function clearFileDragState() {
  fileDragDepth = 0;
  document.body.classList.remove("is-dragging-files");
  elements.dropOverlay.setAttribute("aria-hidden", "true");
}

function carriesFiles(event) {
  return Array.from(event.dataTransfer?.types || []).includes("Files") ||
    (event.dataTransfer?.files?.length || 0) > 0;
}

function isEditablePasteTarget(target) {
  return target instanceof Element && Boolean(
    target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")
  );
}

function loadDesign(source, label, restore = null) {
  logProcess("info", "import", `Loading design ${label}`);
  let design;
  try {
    design = parseDesignSource(source);
  } catch (error) {
    logProcess("error", "parse", `Design parse failed: ${error.message}`, { label });
    setStatus(`Parse failed: ${error.message}`);
    throw error;
  }

  try {
    logProcess("info", "parse", `Parsed ${design.modules.length} module(s)`, {
      label,
      diagnostics: design.diagnostics?.length || 0
    });
    state.design = design;
    state.currentSource = source;
    state.currentSourceLabel = label;
    resetDesignWorkspace(state);
    state.currentModule = null;
    state.searchIndex = buildDesignSearchIndex(state.design);
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
    if (restore?.viewMode && restore.viewMode !== "whole" && restore.coneRootNodeId) {
      state.viewMode = normalizeSingleViewMode(restore.viewMode);
      state.coneRootNodeId = restore.coneRootNodeId;
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
  const requestId = ++state.layoutRequestId;
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
    workspace.then((result) => {
      if (requestId === state.layoutRequestId) commitCompareWorkspace(result, leftModule, rightModule);
    }).catch(handleLayoutFailure);
    return;
  }
  commitCompareWorkspace(workspace, leftModule, rightModule);
}

function commitCompareWorkspace(workspace, leftModule, rightModule) {
  state.compare.fullGraphs = workspace.fullGraphs;
  state.compare.autoGraphs = workspace.autoGraphs;
  state.compare.graphs = workspace.graphs;
  state.compare.analysis = workspace.analysis;
  logProcess("info", "layout", `Compare layout completed: ${workspace.graphs.left.nodes.length} / ${workspace.graphs.right.nodes.length} node(s)`, {
    leftModule: leftModule.name,
    rightModule: rightModule.name
  });
  elements.compareMount.querySelector('[data-compare-side="left"] > header').textContent = leftModule.displayName;
  elements.compareMount.querySelector('[data-compare-side="right"] > header').textContent = rightModule.displayName;
  renderCompareOutputOptions(leftModule, rightModule);
  Promise.all([
    renderGraphMount(elements.leftMount, state.compare.graphs.left),
    renderGraphMount(elements.rightMount, state.compare.graphs.right)
  ]).then(() => {
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
  const restoredWorkspace = switchingModule && restoreModuleWorkspace(state, module.name);
  if (historyEntry) {
    applyModuleHistoryEntry(historyEntry);
  } else if (switchingModule && !restoredWorkspace && shouldUseSearchFirst(module, SEARCH_FIRST_NODE_THRESHOLD)) {
    state.viewMode = "search-first";
    state.coneRootNodeId = null;
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
  state.coneRootNodeId = entry.coneRootNodeId || null;
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
  if (!event.altKey || event.ctrlKey || event.metaKey || isEditablePasteTarget(event.target)) return;
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
  const requestId = ++state.layoutRequestId;
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
    workspace.then((result) => {
      if (requestId === state.layoutRequestId) {
        commitCurrentWorkspace(result, options);
      }
    }).catch(handleLayoutFailure);
    return;
  }
  commitCurrentWorkspace(workspace, options);
}

function commitCurrentWorkspace(workspace, options = {}) {
  state.fullGraph = workspace.fullGraph;
  logProcess("info", "layout", `Layout completed: ${workspace.graph.nodes.length} node(s), ${workspace.graph.edges.length} edge(s)`, {
    fullNodes: workspace.fullGraph.nodes.length,
    viewMode: workspace.graph.view?.mode || state.viewMode
  });
  commitCurrentGraph(workspace.autoGraph, workspace.graph, options);
}

function commitCurrentGraph(autoGraph, graph, options = {}) {
  const { readyMessage = null, onRendered = null } = options;
  state.autoGraph = autoGraph;
  state.graph = graph;
  renderGraphMount(elements.mount, graph).then(() => {
    applyTransform();
    setStatus(readyMessage || `Ready (${getCurrentLayoutProvider().label})`);
    onRendered?.(graph);
  });
  updateCalibrationControls();
  updateViewControls();
  persistSession();
}

function renderGraphMount(mount, graph) {
  if (graph?.view?.mode === "search-first") {
    mount.innerHTML = `<div class="search-first-empty"><strong>Search-first mode</strong><span>${Number(graph.view.totalNodes) || 0} nodes are indexed. Search for a cell to open its focused neighborhood, or choose Whole for an explicit overview.</span></div>`;
    return Promise.resolve();
  }
  return renderSchematicIntoMount(mount, graph, {
    onProgress: ({ phase, rendered, total }) => {
      if (phase === "render") {
        setStatus(`Rendering ${rendered}/${total}…`);
        logProcess("debug", "render", `Rendering ${rendered}/${total}`, { rendered, total }, { progressKey: "svg-batch" });
      }
    }
  });
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
  if (mode !== "whole" && mode !== "search-first") {
    const rootNodeId = state.selectedNodeId || state.coneRootNodeId;
    if (!rootNodeId) {
      setStatus("Select a cell before opening Focused view");
      return;
    }
    state.coneRootNodeId = rootNodeId;
  }
  state.viewMode = mode;
  renderCurrentModuleGraph();
  state.transform = { x: 0, y: 0, scale: 1 };
  setSelectedNode(state.coneRootNodeId);
  applyTransform();
  const message = mode === "whole"
    ? "Whole module overview"
    : mode === "focused"
      ? `Focused neighborhood: fanin ${state.faninDepth}, fanout ${state.fanoutDepth}`
      : "Search-first mode";
  setStatus(message);
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
  if (state.viewMode === "focused") setViewMode("focused");
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
    state.coneRootNodeId = null;
  }
  renderCurrentModuleGraph();
  state.selectedNodeId = null;
  setSelectedNode(state.graph.nodes.some((node) => node.id === selectedNodeId) ? selectedNodeId : null);
  applyTransform();
  setStatus(state.showAliases ? "Alias nodes shown" : `Collapsed ${state.fullGraph.aliases?.length || 0} alias node(s)`);
}

function updateViewControls() {
  const hasRoot = Boolean(state.selectedNodeId || state.coneRootNodeId);
  elements.wholeViewButton.classList.toggle("is-active", state.viewMode === "whole");
  elements.focusedViewButton.classList.toggle("is-active", state.viewMode === "focused");
  elements.focusedViewButton.disabled = !hasRoot;
  elements.coneDepthInput.disabled = !state.compare.active || !state.compare.outputName;
  elements.faninDepthInput.disabled = state.viewMode !== "focused";
  elements.fanoutDepthInput.disabled = state.viewMode !== "focused";
  elements.showAliasesInput.checked = state.showAliases;
  elements.fanoutHubsInput.checked = state.useFanoutHubs;
  elements.collapseGroupsInput.checked = state.collapseLargeGroups;
  elements.collapseAllButton.disabled = state.expandedGroupIds.size === 0;
  updateModuleHistoryControls();
  updateFocusedRootControl();
  updateFocusSelectedControl();
}

function updateFocusedRootControl() {
  const target = state.compare.active ? null : resolveFocusedRootTarget(
    state.fullGraph,
    state.selectedNodeId,
    state.coneRootNodeId,
    state.viewMode
  );
  elements.setFocusedRootButton.disabled = !target;
}

function setSelectedAsFocusedRoot() {
  const nodeId = resolveFocusedRootTarget(
    state.fullGraph,
    state.selectedNodeId,
    state.coneRootNodeId,
    state.viewMode
  );
  if (!nodeId || state.compare.active) return;
  const requestId = ++state.selectionFocusRequestId;
  state.viewMode = "focused";
  state.coneRootNodeId = nodeId;
  state.transform = { x: 0, y: 0, scale: 1 };
  updateViewControls();
  setStatus("Rebuilding Focused view around selected cell…");
  renderCurrentModuleGraph({
    onRendered: (graph) => {
      if (requestId !== state.selectionFocusRequestId || state.coneRootNodeId !== nodeId) return;
      const node = graph.nodes.find((item) => item.id === nodeId);
      if (!node) return;
      setSelectedNode(nodeId);
      focusPositionedCell(node, elements.mount, state.transform, (transform) => { state.transform = transform; });
      applyTransform();
      setStatus(`Focused neighborhood root: ${node.label}`);
    }
  });
}

function updateFocusSelectedControl() {
  const singleCell = !state.compare.active && state.fullGraph?.nodes.some(
    (node) => node.id === state.selectedNodeId && node.kind === "cell"
  );
  const compareCell = state.compare.active && state.compare.selectedKind === "cell" && Boolean(state.compare.selectedName);
  elements.focusSelectedButton.disabled = !(singleCell || compareCell);
}

function handleFocusSelectedShortcut(event) {
  if (event.key.toLowerCase() !== "f" || event.altKey || event.ctrlKey || event.metaKey || isEditablePasteTarget(event.target)) return;
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
  state.coneRootNodeId = selectedNodeId;
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
  const focus = String(value).replace(/^cell:/, "");
  const node = state.fullGraph?.nodes.find((item) => {
    if (item.kind !== "cell") return false;
    return [item.id, item.id.replace(/^cell:/, ""), item.label, item.ref?.instance, item.ref?.instanceDisplayName]
      .includes(value) || item.ref?.instance === focus;
  });
  if (!node) return Promise.reject(new Error(`Startup focus cell not found: ${value}`));
  const nodeId = node.id;
  state.selectedNodeId = nodeId;
  state.viewMode = "focused";
  state.coneRootNodeId = nodeId;
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
  commit(getFocusedObjectTransform({
    viewBox: svg.viewBox.baseVal,
    viewportWidth: svg.getBoundingClientRect().width,
    bounds: node,
    targetPixels: 220,
    minimumScale: 0.25,
    maximumScale: getAdaptiveMaxScale(svg.viewBox.baseVal.width, svg.getBoundingClientRect().width),
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

function handleWireSpacingChange(event) {
  const value = Number(event.target.value);
  state.layoutPolicy.spacing.wireLanePitch = clamp(value, 8, 40);
  elements.wireSpacingValue.value = String(state.layoutPolicy.spacing.wireLanePitch);
  if (!state.currentModule) {
    return;
  }

  if (state.compare.active) {
    renderCompareGraphs();
    renderStats();
    setStatus(`Wire spacing: ${state.layoutPolicy.spacing.wireLanePitch}px`);
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
  setStatus(`Wire spacing: ${state.layoutPolicy.spacing.wireLanePitch}px`);
}

function handleCellSpacingChange(event) {
  const value = Number(event.target.value);
  state.layoutPolicy.spacing.cellSpacing = clamp(value, 8, 120);
  elements.cellSpacingValue.value = String(state.layoutPolicy.spacing.cellSpacing);
  persistSession();
  if (!state.currentModule) return;
  const selectedNodeId = state.selectedNodeId;
  const previousTransform = { ...state.transform };
  rerenderActiveGraph();
  if (!state.compare.active) {
    state.transform = previousTransform;
    state.selectedNodeId = null;
    setSelectedNode(selectedNodeId);
    applyTransform();
  }
  setStatus(`Cell spacing: ${state.layoutPolicy.spacing.cellSpacing}px`);
}

function handleTimingDisplayPolicyChange() {
  const metric = elements.timingMetricSelect.value;
  state.timingDisplayPolicy = {
    snapshot: elements.timingSnapshotSelect.value,
    metrics: metric === "all" ? ["at", "rt", "slack"] : [metric]
  };
  persistSession();
  if (state.timing && state.currentModule) rerenderActiveGraph();
  setStatus(`Timing: ${state.timingDisplayPolicy.snapshot} / ${metric}`);
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
    const next = setCellConfigDefinition(state.cellConfig, activeCellDefinition.cellType, definition);
    state.cellConfig = saveStoredCellConfig(next);
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
  state.cellConfig = saveStoredCellConfig(removeCellConfigDefinition(state.cellConfig, cellType));
  closeCellDefinitionDialog();
  rebuildAfterCellConfigChange(`${cellType}: saved Cell Config deleted`);
}

async function handleCellConfigImport(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const incoming = parseCellConfig(await file.text());
    const { bundle, conflicts } = mergeCellConfigs(state.cellConfig, incoming);
    if (conflicts.length && !window.confirm(`Replace ${conflicts.length} existing Cell Config definition(s): ${conflicts.join(", ")}?`)) return;
    state.cellConfig = saveStoredCellConfig(bundle);
    rebuildAfterCellConfigChange(`Imported Cell Config ${file.name}: ${Object.keys(incoming.cells).length} definition(s)`);
  } catch (error) {
    setStatus(`Cell Config import failed ${file.name}: ${error.message}`);
  } finally {
    event.target.value = "";
  }
}

function exportCellConfig() {
  downloadText(`${serializeCellConfig(state.cellConfig)}\n`, "netlist-cell-config.json", "application/json");
  setStatus(`Exported ${Object.keys(state.cellConfig.cells).length} Cell Config definition(s)`);
}

function resetAllCellConfig() {
  const count = Object.keys(state.cellConfig.cells).length;
  if (count === 0) return;
  if (!window.confirm(`Remove all ${count} saved Cell Config definition(s)?`)) return;
  state.cellConfig = saveStoredCellConfig(createEmptyCellConfig());
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
      viewMode: state.viewMode
    }, SEARCH_FIRST_NODE_THRESHOLD);
    state.viewMode = refreshView.viewMode;
    if (refreshView.viewMode === "focused" || refreshView.viewMode === "search-first") {
      state.coneRootNodeId = refreshView.coneRootNodeId;
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
  const node = state.graph?.nodes.find((item) => item.id === nodeId) || null;
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

function handleSearchInput() {
  const query = elements.searchInput.value;
  state.searchQuery = query;
  state.searchResults = searchDesignIndex(state.searchIndex, query);
  state.activeSearchResult = state.searchResults.length > 0 ? 0 : -1;
  renderSearchResults();
}

function handleSearchKeydown(event) {
  if (event.key === "Escape") {
    elements.searchResults.hidden = true;
    state.activeSearchResult = -1;
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") {
    return;
  }
  if (state.searchResults.length === 0) {
    return;
  }

  event.preventDefault();
  if (event.key === "Enter") {
    activateSearchResult(state.searchResults[Math.max(0, state.activeSearchResult)]);
    return;
  }

  const direction = event.key === "ArrowDown" ? 1 : -1;
  state.activeSearchResult = (
    state.activeSearchResult + direction + state.searchResults.length
  ) % state.searchResults.length;
  renderSearchResults();
  elements.searchResults.querySelector(".search-result.is-active")?.scrollIntoView({ block: "nearest" });
}

function handleSearchResultClick(event) {
  const button = event.target.closest("[data-search-index]");
  if (!button) {
    return;
  }
  activateSearchResult(state.searchResults[Number(button.dataset.searchIndex)]);
}

function renderSearchResults() {
  const hasQuery = elements.searchInput.value.trim() !== "";
  elements.searchClearButton.hidden = !hasQuery;
  if (!hasQuery) {
    elements.searchResults.hidden = true;
    elements.searchResults.innerHTML = "";
    return;
  }

  elements.searchResults.hidden = false;
  if (state.searchResults.length === 0) {
    elements.searchResults.innerHTML = `<div class="search-empty">No matches</div>`;
    return;
  }

  elements.searchResults.innerHTML = state.searchResults
    .map((result, index) => {
      const active = index === state.activeSearchResult;
      const context = result.kind === "module"
        ? result.detail
        : `${result.detail} / ${result.moduleName}`;
      return `<button class="search-result${active ? " is-active" : ""}" type="button" role="option" aria-selected="${active}" data-search-index="${escapeAttr(index)}" title="${escapeAttr(result.label)}">
        <span class="search-result-kind">${escapeHtml(result.kind)}</span>
        <span class="search-result-label">${escapeHtml(result.label)}</span>
        <span class="search-result-context">${escapeHtml(context)}</span>
      </button>`;
    })
    .join("");
}

function clearSearch() {
  elements.searchInput.value = "";
  state.searchQuery = "";
  state.searchResults = [];
  state.activeSearchResult = -1;
  renderSearchResults();
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
    state.coneRootNodeId = fullNode.id;
    state.viewMode = "focused";
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
  const scale = getReadableObjectScale({
    viewBoxWidth: viewBox.width,
    viewportWidth: svg.getBoundingClientRect().width,
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
  updateFocusSelectedControl();
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
    setSelectedNode(nodeElement.dataset.nodeId);
    return;
  }

  const edgeElement = event.target.closest("[data-edge-id]");
  if (edgeElement) {
    setSelectedNet(edgeElement.dataset.net);
    return;
  }

  const start = {
    x: event.clientX,
    y: event.clientY,
    transform: { ...state.transform }
  };
  let didPan = false;
  const panFrames = createLatestFrameScheduler((point) => {
    const viewBox = svg.viewBox.baseVal;
    const rect = svg.getBoundingClientRect();
    state.transform = getPannedTransform(start.transform, start, point, viewBox, rect);
    applyTransform(false);
  });

  startPointerSession({
    target: elements.canvas,
    pointerId: event.pointerId,
    className: "is-panning",
    onMove: (moveEvent) => {
      const point = pointerClientPoint(moveEvent);
      didPan ||= hasPointerDragged(start, point);
      panFrames.schedule(point);
    },
    onEnd: (endEvent) => {
      panFrames.flush();
      persistSession();
      if (!didPan && endEvent?.type !== "pointercancel") setSelectedNode(null);
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

  event.preventDefault();
  setSelectedNode(nodeId);

  const startPoint = eventPointToContent(event);
  const startPosition = { x: node.x, y: node.y };
  const preview = createNodeDragPreview(
    elements.mount,
    state.graph,
    nodeId,
    startPosition
  );
  let moved = false;
  const dragFrames = createLatestFrameScheduler((pointer) => {
    const point = eventPointToContent(pointer);
    if (!point || !startPoint) return;

    const candidatePosition = getDraggedNodePosition(startPosition, startPoint, point);
    const snapResult = snapNodePosition(state.graph, nodeId, candidatePosition);
    const nextPosition = {
      x: round(Math.max(16, snapResult.position.x)),
      y: round(Math.max(16, snapResult.position.y))
    };
    const previous = state.nodePositions.get(nodeId);
    if (sameNodePosition(previous, nextPosition)) return;

    moved = true;
    state.nodePositions.set(nodeId, nextPosition);
    preview.update(nextPosition);
    if (snapResult.snap) {
      setStatus(`${node.label}: snapped ${snapResult.snap.net} to y=${snapResult.snap.targetY}`);
    } else {
      setStatus(`${node.label}: x=${nextPosition.x}, y=${nextPosition.y}`);
    }
  });

  startPointerSession({
    target: elements.canvas,
    pointerId: event.pointerId,
    className: "is-node-dragging",
    onMove: (moveEvent) => dragFrames.schedule(pointerClientPoint(moveEvent)),
    onEnd: () => {
      dragFrames.flush();
      if (!moved) {
        preview.clear();
        return;
      }
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
  preview.clear();
  renderGraphMount(elements.mount, state.graph).then(() => {
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
  const fileName = `${sanitizeFileName(state.currentModule.name)}-${viewSuffix}.svg`;
  downloadText(createStandaloneSvg(renderSchematicSvg(state.graph)), fileName, "image/svg+xml");
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
  const module = resolveLayoutGoldenModule(state.design, imported);

  if (state.compare.active) exitCompareView();
  if (state.currentModule?.name !== module.name) selectModule(module.name);
  applyLayoutGoldenState(state, imported);

  elements.coneDepthInput.value = String(state.coneDepth);
  elements.wireSpacingInput.value = String(clamp(state.layoutPolicy.spacing.wireLanePitch, 8, 40));
  elements.wireSpacingValue.value = elements.wireSpacingInput.value;
  elements.cellSpacingInput.value = String(clamp(state.layoutPolicy.spacing.cellSpacing, 8, 120));
  elements.cellSpacingValue.value = elements.cellSpacingInput.value;
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
    layoutOptions: {
      layoutPolicy: state.layoutPolicy,
      graphOverrides: state.graphOverrides,
      timingBadgeChoices: state.timingBadgeChoices,
      timingBadgePositions: state.timingBadgePositions,
      display: {
        viewMode: state.viewMode,
        coneRootNodeId: state.coneRootNodeId,
        coneDepth: state.coneDepth,
        useFanoutHubs: state.useFanoutHubs,
        collapseLargeGroups: state.collapseLargeGroups,
        expandedGroupIds: [...state.expandedGroupIds]
      }
    },
    svgSnapshot: renderSchematicSvg(state.graph)
  });
  downloadJson(
    {
      ...golden,
      diff
    },
    `layout-golden-${sanitizeFileName(state.currentModule.name)}.json`
  );
  logProcess("info", "export", `Exported layout Golden for ${state.currentModule.displayName}`, {
    movedNodeCount: diff.movedNodeCount,
    maxMove: diff.maxMove
  });
  setStatus(`Saved layout golden: ${diff.movedNodeCount} moved node(s), max move ${diff.maxMove}px`);
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
    selectCompareObject(graphNode?.kind === "cell" ? "cell" : "port", getCompareNodeName(graphNode), true, side);
    return;
  }
  const edgeElement = event.target.closest("[data-edge-id]");
  if (edgeElement) {
    selectCompareObject("net", edgeElement.dataset.net, true, side);
    return;
  }
  const start = { x: event.clientX, y: event.clientY, transform: { ...state.compare.transforms[side] } };
  const panFrames = createLatestFrameScheduler((point) => {
    const rect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox.baseVal;
    setCompareTransform(side, getPannedTransform(start.transform, start, point, viewBox, rect));
  });
  startPointerSession({
    target: elements.canvas,
    pointerId: event.pointerId,
    className: "is-panning",
    onMove: (moveEvent) => panFrames.schedule(pointerClientPoint(moveEvent)),
    onEnd: () => panFrames.flush()
  });
}

function startCompareNodeDrag(event, side, node) {
  const mount = side === "left" ? elements.leftMount : elements.rightMount;
  const content = mount.querySelector("#schematicContent");
  const matrix = content?.getScreenCTM();
  if (!matrix) return;
  event.preventDefault();
  selectCompareObject(node.kind === "cell" ? "cell" : "port", getCompareNodeName(node), false, side);
  const toContent = (pointerEvent) => {
    const svg = mount.querySelector("svg");
    const currentMatrix = mount.querySelector("#schematicContent")?.getScreenCTM();
    if (!svg || !currentMatrix) return null;
    const point = svg.createSVGPoint();
    point.x = pointerEvent.clientX;
    point.y = pointerEvent.clientY;
    return point.matrixTransform(currentMatrix.inverse());
  };
  const startPoint = toContent(event);
  const startPosition = { x: node.x, y: node.y };
  const preview = createNodeDragPreview(
    mount,
    state.compare.graphs[side],
    node.id,
    startPosition
  );
  let moved = false;
  const dragFrames = createLatestFrameScheduler((pointer) => {
    const point = toContent(pointer);
    if (!point || !startPoint) return;
    const candidate = getDraggedNodePosition(startPosition, startPoint, point);
    const snapped = snapNodePosition(state.compare.graphs[side], node.id, candidate);
    const previous = state.compare.nodePositions[side].get(node.id);
    if (sameNodePosition(previous, snapped.position)) return;
    moved = true;
    state.compare.nodePositions[side].set(node.id, snapped.position);
    preview.update(snapped.position);
  });
  startPointerSession({
    target: elements.canvas,
    pointerId: event.pointerId,
    className: "is-node-dragging",
    onMove: (moveEvent) => dragFrames.schedule(pointerClientPoint(moveEvent)),
    onEnd: () => {
      dragFrames.flush();
      if (!moved) {
        preview.clear();
        return;
      }
      setStatus(`Rerouting ${side} ${node.label}…`);
      runAfterNextPaint(() => {
        preview.clear();
        renderAdjustedCompareSide(side);
        setStatus(`${side} ${node.label}: position adjusted`);
      });
    }
  });
}

function queueWheelGesture(sample) {
  const sameTarget = pendingWheelGesture &&
    pendingWheelGesture.mode === sample.mode &&
    pendingWheelGesture.side === sample.side;
  if (sameTarget) {
    pendingWheelGesture.clientX = sample.clientX;
    pendingWheelGesture.clientY = sample.clientY;
    pendingWheelGesture.steps += sample.deltaY < 0 ? -1 : 1;
  } else {
    wheelFrames.flush();
    pendingWheelGesture = {
      ...sample,
      steps: sample.deltaY < 0 ? -1 : 1
    };
  }
  elements.canvas.classList.add("is-view-interacting");
  clearTimeout(wheelInteractionTimer);
  wheelInteractionTimer = setTimeout(() => {
    elements.canvas.classList.remove("is-view-interacting");
    persistSession();
  }, 140);
  wheelFrames.schedule(pendingWheelGesture);
}

function applyPendingWheelGesture(sample) {
  if (!sample) return;
  if (pendingWheelGesture === sample) pendingWheelGesture = null;
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
      rect.width
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
    rect.width
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
    return;
  }
  const graph = applyWorkspaceOverrides(autoGraph, {
    nodePositions: state.compare.nodePositions[side],
    nodeSizes: state.compare.nodeSizes[side],
    layoutPolicy: state.layoutPolicy
  });
  state.compare.graphs[side] = graph;
  const mount = side === "left" ? elements.leftMount : elements.rightMount;
  mount.innerHTML = renderSchematicSvg(graph, renderOptions);
  applyCompareHighlights();
  applyCompareTransforms();
  updateCalibrationControls();
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

function eventPointToContent(event) {
  const svg = getSvg();
  const content = elements.mount.querySelector("#schematicContent");
  const matrix = content?.getScreenCTM();
  if (!svg || !matrix) {
    return null;
  }

  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  return point.matrixTransform(matrix.inverse());
}

function pointerClientPoint(event) {
  return {
    x: event.clientX,
    y: event.clientY,
    clientX: event.clientX,
    clientY: event.clientY
  };
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
  if (options.progressKey) {
    processLog.progress({ level, phase, message, details, key: options.progressKey });
  } else {
    processLog.append({ level, phase, message, details });
  }
  if (level === "error") toggleProcessLogDrawer(true);
  renderProcessLog();
}

function toggleProcessLogDrawer(forceOpen = null) {
  const open = forceOpen === null
    ? elements.processLogList.hidden
    : Boolean(forceOpen);
  elements.processLogList.hidden = !open;
  elements.processLogControls.hidden = !open;
  elements.toggleProcessLogButton.setAttribute("aria-expanded", String(open));
  if (open) renderProcessLog();
}

function getProcessLogFilters() {
  return {
    level: elements.processLogLevelFilter.value,
    phase: elements.processLogPhaseFilter.value
  };
}

function renderProcessLog() {
  elements.processLogCount.textContent = String(processLog.size);
  if (elements.processLogList.hidden) return;
  const entries = processLog.entries(getProcessLogFilters());
  elements.processLogList.innerHTML = renderProcessLogEntries(entries);
  if (elements.processLogAutoScroll.checked) {
    elements.processLogList.scrollTop = elements.processLogList.scrollHeight;
  }
}

async function copyProcessLog() {
  const text = processLog.toJsonLines(getProcessLogFilters());
  try {
    await navigator.clipboard.writeText(text);
    setStatus(`Copied ${processLog.entries(getProcessLogFilters()).length} log entry(s)`);
  } catch (error) {
    setStatus(`Copy log failed: ${error.message}`);
  }
}

function exportProcessLog() {
  const text = processLog.toJsonLines(getProcessLogFilters());
  downloadText(`${text}${text ? "\n" : ""}`, "netlist-process-log.jsonl", "application/x-ndjson");
  setStatus(`Exported ${processLog.entries(getProcessLogFilters()).length} log entry(s)`);
}

function clearProcessLog() {
  processLog.clear();
  renderProcessLog();
  setStatus("Process Log cleared");
}

function applySessionPreferences(session) {
  if (session) {
    state.coneDepth = clamp(Number(session.coneDepth) || 3, 1, 99);
    state.faninDepth = clamp(Number.isFinite(Number(session.faninDepth)) ? Number(session.faninDepth) : 3, 0, 99);
    state.fanoutDepth = clamp(Number.isFinite(Number(session.fanoutDepth)) ? Number(session.fanoutDepth) : 3, 0, 99);
    state.showAliases = Boolean(session.showAliases);
    state.layoutProviderId = session.layoutProviderId || state.layoutProviderId;
    state.useFanoutHubs = session.useFanoutHubs !== false;
    state.collapseLargeGroups = session.collapseLargeGroups !== false;
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
  elements.cellSpacingInput.value = String(state.layoutPolicy.spacing.cellSpacing);
  elements.cellSpacingValue.value = elements.cellSpacingInput.value;
  elements.timingSnapshotSelect.value = state.timingDisplayPolicy.snapshot;
  elements.timingMetricSelect.value = state.timingDisplayPolicy.metrics.length === 3
    ? "all" : state.timingDisplayPolicy.metrics[0];
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

function downloadJson(value, fileName) {
  downloadText(`${JSON.stringify(value, null, 2)}\n`, fileName, "application/json");
}

function downloadText(value, fileName, type) {
  const blob = new Blob([value], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function sanitizeFileName(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]+/g, "_");
}
