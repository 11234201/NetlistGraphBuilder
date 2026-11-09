import { createWorkbenchControllers } from "./workbench_controllers.js";
import { DEFAULT_LAYOUT_POLICY } from "../layout/layoutPolicy.js";
import { createRenderGeneration } from "../render/renderGeneration.js";
import { createLayoutSpacingController } from "../ui/layout_spacing_controller.js";
import { createTimingDisplayController } from "../ui/timing_display_controller.js";
import { createQuickInputController } from "../ui/quick_input_controller.js";
import { createWheelGestureController } from "../ui/wheel_gesture_controller.js";
import { createSearchControls } from "../ui/searchControls.js";
import { createDefaultDomainRegistry } from "../bootstrap/default_domains.js";
import { createModuleHierarchyController } from "../ui/module_hierarchy_controller.js";
import { buildModuleHierarchy } from "../domains/netlist/module_hierarchy.js";
import { createSchematicSelectionController } from "../ui/schematic_selection_controller.js";
import { createBrowserDownload } from "../platform/browser_download.js";
import { loadStoredCellConfig, saveStoredCellConfig } from "../persistence/cell_config_storage.js";
import { createCellConfigUseCases } from "../domains/netlist/cell_config_use_cases.js";
import { createAppState } from "./appState.js";
import { createSessionSnapshot, loadSessionState, saveSessionState } from "./sessionState.js";
import { createSingleViewSessionBridge } from "./single_view_session_bridge.js";
import { createCompareViewSessionBridge } from "./compare_view_session_bridge.js";
import { createProcessLogController } from "../ui/process_log_controller.js";
import {
  closeAllDisclosures,
  closeDisclosuresOutside,
  closeOtherDisclosures
} from "../ui/disclosure.js";
import { createDocumentStore } from "../application/document_store.js";
import { createViewSessionStore } from "../application/view_session_store.js";
import { createArtifactStore } from "../application/artifact_store.js";
import { createJobCoordinator } from "../application/job_coordinator.js";
import { createWorkspaceExecution } from "../application/workspace_execution.js";
import { createViewHistoryTransaction } from "./viewHistoryTransaction.js";

const state = createAppState(DEFAULT_LAYOUT_POLICY);
const {
  initializeApplication,
  createStartupHandlers,
  startSidebarResize,
  handleSidebarResizeKeydown,
  setSidebarWidth,
  loadQuickInputText,
  loadTimingText,
  loadDesign,
  renderModuleOptions,
  renderModuleHierarchy,
  renderOccurrenceChoicePanel,
  handleOccurrenceChoiceClick,
  updateModuleHierarchyPicker,
  renderCompareModuleOptions,
  handleCompareOutputChange,
  enterCompareView,
  applyCompareSelection,
  applyCompareSelectionImpl,
  exitCompareView,
  applyCompareLayout,
  renderCompareGraphs,
  commitCompareWorkspace,
  updateCompareSideStatus,
  renderCompareOutputOptions,
  getCompareModule,
  selectModule,
  handleModuleHistoryShortcut,
  handleViewHistoryShortcut,
  navigateViewHistory,
  restoreViewHistoryEntry,
  createSingleWorkspaceHistoryIdentity,
  restoreCompareViewHistoryEntry,
  createCompareWorkspaceHistoryIdentity,
  cloneGraphOverridesForHistory,
  cloneObjectRefs,
  updateViewHistoryControls,
  renderCurrentModuleGraph,
  commitCurrentWorkspace,
  commitCurrentGraph,
  renderGraphMount,
  renderLayoutProviderOptions,
  handleLayoutProviderChange,
  handleLayoutFailure,
  isPromise,
  setViewMode,
  setViewModeImpl,
  setCompareViewMode,
  setCompareViewModeImpl,
  handleConeDepthChange,
  handleFocusedDepthChange,
  scheduleFocusedDepthChange,
  handleAliasVisibilityChange,
  updateViewControls,
  updateFocusedRootControl,
  getSelectedSingleCell,
  getFocusedRootContext,
  setCompareFocusedRootNodeIds,
  syncCompareFocusedRootNode,
  setSelectedAsFocusedRoot,
  setSelectedCompareAsFocusedRoot,
  addSelectedAsFocusedRoot,
  addSelectedCompareAsFocusedRoot,
  removeSelectedFromFocusedRoots,
  removeSelectedCompareFocusedRoot,
  clearFocusedRoots,
  handleFocusedRootListClick,
  handleCompareFocusedRootListClick,
  renderFocusedRootList,
  updateFocusSelectedControl,
  handleFocusSelectedShortcut,
  focusSelectedCell,
  selectStartupModule,
  focusStartupCell,
  focusStartupCells,
  normalizeStartupFocusTarget,
  sameOccurrencePath,
  focusSelectedCompareCell,
  focusPositionedCell,
  focusPositionedEdge,
  handleGraphSimplificationChange,
  rerenderActiveGraph,
  commitLayoutSpacing,
  commitTimingDisplayPolicy,
  commitGateSymbolMode,
  refreshComparePresentationScenes,
  openSelectedCellDefinition,
  closeCellDefinitionDialog,
  saveActiveCellDefinition,
  deleteActiveCellDefinition,
  handleCellConfigImport,
  exportCellConfig,
  resetAllCellConfig,
  rebuildAfterCellConfigChange,
  updateCellDefinitionControls,
  handleSingleNodeSelection,
  handleSingleNetSelection,
  setSelectedNode,
  setSelectedNet,
  clearSchematicSelection,
  handleSelectionNavigationClick,
  navigateSingleSelectionTarget,
  selectionTargetChangesHierarchyContext,
  replaceFocusWithSelectionTarget,
  focusSingleSelectionTarget,
  selectionTargetExists,
  navigateCompareSelectionTarget,
  activateSearchResult,
  revealSearchTarget,
  addSearchResultToFocus,
  centerGraphPoint,
  getEdgeCenter,
  renderStats,
  signed,
  formatGateKinds,
  applyCompareHighlights,
  selectCompareObject,
  clearCompareSelection,
  compareObjectExists,
  renderCompareSelection,
  bindCompareSelectionControls,
  focusCompareSelection,
  renderSelection,
  renderNetSelection,
  currentHierarchyInspectionContext,
  renderDiagnostics,
  bindSelectionControls,
  updateTimingBadgePosition,
  updateNodeSize,
  updateNodeProperty,
  updateCellPinDirection,
  updateTimingBadgeChoice,
  rerenderPreservingView,
  handleWheel,
  handlePointerDown,
  handleCanvasDoubleClick,
  resolveChildOccurrenceNavigation,
  startNodeDrag,
  commitNodeDrag,
  fitToView,
  exportCurrentSvg,
  toggleCalibrationMode,
  resetLayoutOverrides,
  resetLayoutOverridesImpl,
  loadLayoutGolden,
  loadLayoutGoldenImpl,
  saveLayoutGolden,
  currentPersistenceIdentity,
  updateCalibrationControls,
  applyTransform,
  setSingleTransform,
  setSingleLayoutPolicy,
  setSingleViewMode,
  setSingleFocusedDepths,
  replaceSingleFocusedRoots,
  setSingleOverrides,
  updateSingleOverrides,
  setCompareOverrides,
  updateCompareOverrides,
  handleCompareWheel,
  handleComparePointerDown,
  toggleCompareFocusedRoot,
  startCompareNodeDrag,
  queueWheelGesture,
  applyPendingWheelGesture,
  runAfterNextPaint,
  renderAdjustedCompareSide,
  setCompareTransform,
  applyCompareTransforms,
  eventPointToSvg,
  getSvg,
  getCurrentLayoutProvider,
  setStatus,
  logProcess,
  applySessionPreferences,
  syncLayoutSpacingControls,
  persistSession,
  recordViewHistory,
  noteViewCommandDispatch,
  viewCommandLabel,
  runViewHistoryTransaction,
  isEditableNodeProperty,
  getNodeInstance,
  countGraphOverrides,
  hasCompareLayoutOverrides,
  cssEscape,
  clamp,
  round
} = createWorkbenchControllers({ state, getElements: () => elements, services: {
  get SEARCH_FIRST_NODE_THRESHOLD() { return SEARCH_FIRST_NODE_THRESHOLD; },
  get applyCompareHighlights() { return applyCompareHighlights; },
  get applyCompareLayout() { return applyCompareLayout; },
  get applyCompareSelection() { return applyCompareSelection; },
  get applyCompareTransforms() { return applyCompareTransforms; },
  get applyTransform() { return applyTransform; },
  get browserDownload() { return browserDownload; },
  get cellConfigUseCases() { return cellConfigUseCases; },
  get centerGraphPoint() { return centerGraphPoint; },
  get clamp() { return clamp; },
  get clearCompareSelection() { return clearCompareSelection; },
  get clearSearch() { return clearSearch; },
  get cloneObjectRefs() { return cloneObjectRefs; },
  get compareViewSessions() { return compareViewSessions; },
  get countGraphOverrides() { return countGraphOverrides; },
  get cssEscape() { return cssEscape; },
  get documents() { return documents; },
  get exitCompareView() { return exitCompareView; },
  get focusPositionedCell() { return focusPositionedCell; },
  get focusPositionedEdge() { return focusPositionedEdge; },
  get focusSelectedCell() { return focusSelectedCell; },
  get focusStartupCell() { return focusStartupCell; },
  get focusStartupCells() { return focusStartupCells; },
  get getCompareModule() { return getCompareModule; },
  get getCurrentLayoutProvider() { return getCurrentLayoutProvider; },
  get getEdgeCenter() { return getEdgeCenter; },
  get getFocusedRootContext() { return getFocusedRootContext; },
  get getNodeInstance() { return getNodeInstance; },
  get getSelectedSingleCell() { return getSelectedSingleCell; },
  get getSvg() { return getSvg; },
  get handleComparePointerDown() { return handleComparePointerDown; },
  get handleCompareWheel() { return handleCompareWheel; },
  get handleLayoutFailure() { return handleLayoutFailure; },
  get handleSearchInput() { return handleSearchInput; },
  get hasCompareLayoutOverrides() { return hasCompareLayoutOverrides; },
  get isEditableNodeProperty() { return isEditableNodeProperty; },
  get layoutSpacingController() { return layoutSpacingController; },
  get loadLayoutGolden() { return loadLayoutGolden; },
  get logProcess() { return logProcess; },
  get moduleHierarchyController() { return moduleHierarchyController; },
  get netlistFeature() { return netlistFeature; },
  get persistSession() { return persistSession; },
  get processLogController() { return processLogController; },
  get queueWheelGesture() { return queueWheelGesture; },
  get recordViewHistory() { return recordViewHistory; },
  get renderCompareGraphs() { return renderCompareGraphs; },
  get renderCompareModuleOptions() { return renderCompareModuleOptions; },
  get renderCompareOutputOptions() { return renderCompareOutputOptions; },
  get renderCompareSelection() { return renderCompareSelection; },
  get renderCurrentModuleGraph() { return renderCurrentModuleGraph; },
  get renderDiagnostics() { return renderDiagnostics; },
  get renderFocusedRootList() { return renderFocusedRootList; },
  get renderGeneration() { return renderGeneration; },
  get renderGraphMount() { return renderGraphMount; },
  get renderModuleOptions() { return renderModuleOptions; }, get renderNetSelection() { return renderNetSelection; },
  get renderSelection() { return renderSelection; },
  get renderStats() { return renderStats; },
  get replaceSingleFocusedRoots() { return replaceSingleFocusedRoots; },
  get rerenderPreservingView() { return rerenderPreservingView; },
  get runAfterNextPaint() { return runAfterNextPaint; },
  get runViewHistoryTransaction() { return runViewHistoryTransaction; },
  get sameOccurrencePath() { return sameOccurrencePath; },
  get schematicSelectionController() { return schematicSelectionController; },
  get selectCompareObject() { return selectCompareObject; },
  get selectModule() { return selectModule; },
  get selectStartupModule() { return selectStartupModule; },
  get setCompareFocusedRootNodeIds() { return setCompareFocusedRootNodeIds; },
  get setCompareOverrides() { return setCompareOverrides; },
  get setCompareTransform() { return setCompareTransform; },
  get setSelectedNet() { return setSelectedNet; },
  get setSelectedNode() { return setSelectedNode; },
  get setSingleFocusedDepths() { return setSingleFocusedDepths; },
  get setSingleLayoutPolicy() { return setSingleLayoutPolicy; },
  get setSingleOverrides() { return setSingleOverrides; },
  get setSingleTransform() { return setSingleTransform; },
  get setSingleViewMode() { return setSingleViewMode; },
  get setStatus() { return setStatus; },
  get singleViewSession() { return singleViewSession; },
  get syncCompareFocusedRootNode() { return syncCompareFocusedRootNode; },
  get syncLayoutSpacingControls() { return syncLayoutSpacingControls; },
  get timingDisplayController() { return timingDisplayController; },
  get updateCalibrationControls() { return updateCalibrationControls; },
  get updateCellDefinitionControls() { return updateCellDefinitionControls; },
  get updateCompareOverrides() { return updateCompareOverrides; },
  get updateFocusSelectedControl() { return updateFocusSelectedControl; },
  get updateModuleHierarchyPicker() { return updateModuleHierarchyPicker; },
  get updateSingleOverrides() { return updateSingleOverrides; },
  get updateViewControls() { return updateViewControls; },
  get updateViewHistoryControls() { return updateViewHistoryControls; },
  get viewHistoryTransactions() { return viewHistoryTransactions; },
  get viewSessions() { return viewSessions; },
  get wheelGestureController() { return wheelGestureController; },
  get workspaceExecution() { return workspaceExecution; },
  get workspaceJobs() { return workspaceJobs; }
} });

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
const workspaceExecution = createWorkspaceExecution({ jobs: workspaceJobs });
const renderGeneration = createRenderGeneration();
const singleViewSession = createSingleViewSessionBridge({
  state,
  getDocumentId: () => state.document?.documentId || null,
  sessions: viewSessions,
  onDispatch: noteViewCommandDispatch
});
const compareViewSessions = createCompareViewSessionBridge({
  state,
  getDocumentId: () => state.document?.documentId || null,
  sessions: viewSessions,
  onDispatch: noteViewCommandDispatch
});
state.cellConfig = loadStoredCellConfig();
const cellConfigUseCases = createCellConfigUseCases({ save: saveStoredCellConfig });
const SEARCH_FIRST_NODE_THRESHOLD = 500;
const viewHistoryTransactions = createViewHistoryTransaction({
  commit: (metadata) => recordViewHistory(metadata)
});

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
  moduleOccurrenceChoices: document.querySelector("#moduleOccurrenceChoices"),
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
  gateSymbolModeSelect: document.querySelector("#gateSymbolModeSelect"),
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
  timingMetricSelect: document.querySelector("#timingMetricSelect"),
  timingSlackThresholdInput: document.querySelector("#timingSlackThresholdInput"),
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
  onNodeSelection: handleSingleNodeSelection,
  onNetSelection: handleSingleNetSelection
});
const layoutSpacingController = createLayoutSpacingController({
  elements,
  getSpacing: () => state.layoutPolicy.spacing,
  onCommit: commitLayoutSpacing
});
const timingDisplayController = createTimingDisplayController({
  elements: {
    metricSelect: elements.timingMetricSelect,
    thresholdInput: elements.timingSlackThresholdInput
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
elements.compareOutputSelect.addEventListener("change", handleCompareOutputChange);
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
elements.moduleOccurrenceChoices.addEventListener("click", handleOccurrenceChoiceClick);
elements.wholeViewButton.addEventListener("click", () => setViewMode("whole"));
elements.focusedViewButton.addEventListener("click", () => setViewMode("focused"));
elements.coneDepthInput.addEventListener("change", handleConeDepthChange);
elements.faninDepthInput.addEventListener("change", scheduleFocusedDepthChange);
elements.fanoutDepthInput.addEventListener("change", scheduleFocusedDepthChange);
elements.showAliasesInput.addEventListener("change", handleAliasVisibilityChange);
elements.fanoutHubsInput.addEventListener("change", handleGraphSimplificationChange);
elements.gateSymbolModeSelect.addEventListener("change", (event) => commitGateSymbolMode(event.target.value));
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
