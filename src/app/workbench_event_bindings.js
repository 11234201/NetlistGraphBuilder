import { createSearchControls } from "../ui/searchControls.js";

export function bindWorkbenchEvents({ elements, commands, compare, search, windowTarget }) {
  const {
  navigateViewHistory, handleLayoutProviderChange, exitCompareView,
  enterCompareView, applyCompareSelection, applyCompareLayout,
  fitToView, handleCompareOutputChange, activateSearchResult,
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
  } = commands;
  elements.moduleBackButton.addEventListener("click", () => navigateViewHistory(-1));
  elements.moduleForwardButton.addEventListener("click", () => navigateViewHistory(1));
  elements.layoutProviderSelect.addEventListener("change", handleLayoutProviderChange);
  elements.compareButton.addEventListener("click", () => {
    if (compare.isActive()) exitCompareView();
    else enterCompareView();
  });
  elements.applyCompareButton.addEventListener("click", applyCompareSelection);
  elements.exitCompareButton.addEventListener("click", exitCompareView);
  elements.syncCompareInput.addEventListener("change", (event) => { compare.setSynchronized(event.target.checked); });
  elements.syncCompareFocusInput.addEventListener("change", (event) => {
    compare.setRootsSynchronized(event.target.checked);
  });
  elements.compareLayoutSelect.addEventListener("change", (event) => {
    compare.setLayout(event.target.value);
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
    getIndex: search.getIndex,
    onActivate: activateSearchResult,
    onAdd: addSearchResultToFocus,
    onChange: search.onChange
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
  elements.focusedRootsList.ownerDocument.querySelector("#focusedRootsFilter").addEventListener("input", handleFocusedRootsFilter);
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
  elements.canvas.addEventListener("wheel", handleWheel, { passive: false });
  elements.canvas.addEventListener("pointerdown", handlePointerDown);
  elements.canvas.addEventListener("dblclick", handleCanvasDoubleClick);
  windowTarget.addEventListener("keydown", handleModuleHistoryShortcut);
  windowTarget.addEventListener("keydown", handleViewHistoryShortcut);
  windowTarget.addEventListener("keydown", handleFocusSelectedShortcut);
  return { handleSearchInput, clearSearch };
}
