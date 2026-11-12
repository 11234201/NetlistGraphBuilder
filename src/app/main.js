import { createWorkbenchElements, createQuickInputElements, createProcessLogElements } from "../ui/workbench_elements.js";
import { createLibertyController } from "../ui/liberty_controller.js";
import { createLibertyLibraryService } from "../domains/netlist/liberty_import.js";
import { runCooperativeTask } from "../application/cooperative_task.js";
import { createLibraryWorkspaceRefresh } from "./library_workspace_refresh.js";
import { createWorkbenchControllers } from "./workbench_controllers.js";
import { DEFAULT_LAYOUT_POLICY } from "../layout/layoutPolicy.js";
import { createRenderGeneration } from "../render/renderGeneration.js";
import { createLayoutSpacingController } from "../ui/layout_spacing_controller.js";
import { createTimingDisplayController } from "../ui/timing_display_controller.js";
import { createQuickInputController } from "../ui/quick_input_controller.js";
import { createWheelGestureController } from "../ui/wheel_gesture_controller.js";
import { bindWorkbenchEvents } from "./workbench_event_bindings.js";
import { createWorkbenchUi } from "./workbench_ui_bootstrap.js";
import { createDefaultDomainRegistry } from "../bootstrap/default_domains.js";
import { createModuleHierarchyController } from "../ui/module_hierarchy_controller.js";
import { buildModuleHierarchy } from "../domains/netlist/module_hierarchy.js";
import { createSchematicSelectionController } from "../ui/schematic_selection_controller.js";
import { createBrowserDownload } from "../platform/browser_download.js";
import { saveStoredCellConfig } from "../persistence/cell_config_storage.js";
import { createCellConfigUseCases } from "../domains/netlist/cell_config_use_cases.js";
import { createAppState } from "./appState.js";
import { createSessionSnapshot } from "./sessionState.js";
import { restoreWorkbenchStorage } from "./workbench_storage.js";
import { createSingleViewSessionBridge } from "./single_view_session_bridge.js";
import { createCompareViewSessionBridge } from "./compare_view_session_bridge.js";
import { createProcessLogController } from "../ui/process_log_controller.js";
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
  handleFocusedRootsFilter,
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
  readCellLibrary: () => libertyService.read(),
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
const cellConfigUseCases = createCellConfigUseCases({ save: saveStoredCellConfig });
const libertyService = createLibertyLibraryService({ execute: runCooperativeTask });
const SEARCH_FIRST_NODE_THRESHOLD = 500;
const viewHistoryTransactions = createViewHistoryTransaction({
  commit: (metadata) => recordViewHistory(metadata)
});

const elements = createWorkbenchElements(document);
const processLogController = createProcessLogController({
  elements: createProcessLogElements(elements),
  windowTarget: window,
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

const refreshLibraryWorkspace = createLibraryWorkspaceRefresh({
  readContext: () => ({ compareActive: state.compare.active, hasModule: Boolean(state.currentModule), selectedNodeId: state.selectedNodeId }),
  cancelJobs: () => workspaceJobs.cancelDocument(state.document?.documentId),
  renderSingle: rerenderPreservingView, renderCompare: renderCompareGraphs
});
const libertyController = createLibertyController({
  elements: { summary: elements.libertySummary, diagnostics: elements.libertyDiagnostics,
    cancelButton: elements.cancelLibertyButton, clearButton: elements.clearLibertyButton },
  read: libertyService.read, importText: libertyService.importText, clear: libertyService.clear,
  cancel: libertyService.cancel, refresh: refreshLibraryWorkspace, setStatus, logProcess
});
createQuickInputController({
  elements: createQuickInputElements(elements, document.body),
  windowTarget: window,
  loadText: (text, options) => options.kind === "liberty" ? libertyController.load(text, options) : loadQuickInputText(text, options),
  setStatus,
  logProcess
});
const { handleSearchInput, clearSearch } = bindWorkbenchEvents({
  elements, windowTarget: window,
  commands: {
  navigateViewHistory, handleLayoutProviderChange, exitCompareView,
  enterCompareView, applyCompareSelection, applyCompareLayout,
  fitToView: () => { fitToView(); workbenchUi.refreshViewport(); }, handleCompareOutputChange, activateSearchResult,
  addSearchResultToFocus, handleSelectionNavigationClick, handleOccurrenceChoiceClick,
  setViewMode, handleConeDepthChange, scheduleFocusedDepthChange,
  handleAliasVisibilityChange, handleGraphSimplificationChange, commitGateSymbolMode,
  setSelectedAsFocusedRoot, addSelectedAsFocusedRoot, removeSelectedFromFocusedRoots,
  clearFocusedRoots, handleFocusedRootListClick, handleFocusedRootsFilter, focusSelectedCell,
  openSelectedCellDefinition, handleCellConfigImport, exportCellConfig,
  resetAllCellConfig, saveActiveCellDefinition, closeCellDefinitionDialog,
  deleteActiveCellDefinition, exportCurrentSvg, toggleCalibrationMode,
  saveLayoutGolden, resetLayoutOverrides, handleWheel,
  handlePointerDown, handleCanvasDoubleClick, handleModuleHistoryShortcut,
  handleViewHistoryShortcut, handleFocusSelectedShortcut,
  },
  compare: {
    isActive: () => state.compare.active,
    setSynchronized: (value) => { state.compare.synchronized = value; },
    setRootsSynchronized: (value) => { state.compare.focusedRootsSynchronized = value; },
    setLayout: (value) => { state.compare.layout = value === "horizontal" ? "horizontal" : "vertical"; }
  },
  search: { getIndex: () => state.searchIndex, onChange: (search) => { state.searchQuery = search.searchQuery; } }
});
const workbenchUi = createWorkbenchUi({
  document, windowTarget: window, singleViewSession, compareViewSessions,
  applyTransform, applyCompareTransforms, closeLog: () => processLogController.toggle(false),
  subscribe: (listener) => viewSessions.subscribe(listener),
  readViews: () => [
    { id: "single", mount: elements.mount, viewport: state.transform },
    { id: "left", mount: elements.leftMount, viewport: state.compare.transforms.left },
    { id: "right", mount: elements.rightMount, viewport: state.compare.transforms.right }
  ],
  readContext: () => ({
    compareActive: state.compare.active, selectedSide: state.compare.selectedSide,
    moduleLabel: elements.moduleHierarchyCurrent.textContent || state.currentModule?.displayName || "Workspace",
    sourceLabel: state.currentSourceLabel || "Sample", viewMode: state.graph?.view?.mode || state.viewMode,
    leftModuleName: state.compare.leftModuleName, rightModuleName: state.compare.rightModuleName,
    leftMode: state.compare.graphs.left?.view?.mode, rightMode: state.compare.graphs.right?.view?.mode
  }),
  onPreferenceError: (error) => logProcess("warning", "persistence", "UI preferences unavailable; using this window only", { error })
});

const restoredSession = restoreWorkbenchStorage({
  windowTarget: window,
  logProcess,
  setCellConfig: (bundle) => { state.cellConfig = bundle; },
  getSessionSnapshot: () => state.currentSource ? createSessionSnapshot(state) : null
});
applySessionPreferences(restoredSession);
renderLayoutProviderOptions();
initializeApplication(restoredSession);
updateCalibrationControls();
