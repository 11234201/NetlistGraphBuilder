import {
  collectCellTypeSummary,
  createInferredCellDefinition,
  renderCellDefinitionEditor,
  readCellDefinitionEditor
} from "../ui/cellDefinitionPanel.js";
import { serializeCellConfig } from "../infer/cellConfig.js";
import { resolveCellConfigRefreshView } from "./graphWorkspace.js";

// Legacy workbench adapter. State and elements are restricted ports supplied
// by the composition root; peer actions are explicit, late-bound services.
export function createCellConfigController({ state, elements, services }) {
  let activeCellDefinition = null;
  function openSelectedCellDefinition() {
    const node = state.fullGraph?.nodes.find((item) => item.id === state.selectedNodeId)
      || state.graph?.nodes.find((item) => item.id === state.selectedNodeId);
    if (!node || node.kind !== "cell") {
      services.setStatus("Select a primitive cell first");
      return;
    }
    if (node.referencedModuleName) {
      services.setStatus(`${node.label}: real submodule definitions cannot be replaced by Cell Config`);
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
      state.cellConfig = services.cellConfigUseCases.set(state.cellConfig, activeCellDefinition.cellType, definition);
      const cellType = activeCellDefinition.cellType;
      closeCellDefinitionDialog();
      rebuildAfterCellConfigChange(`${cellType}: Cell Config saved`);
    } catch (error) {
      services.logProcess("error", "persistence", `Cell Config save failed: ${error.message}`, { error, cellType: activeCellDefinition?.cellType });
      services.setStatus(`Cell Config save failed: ${error.message}`);
    }
  }

  function deleteActiveCellDefinition() {
    if (!activeCellDefinition) return;
    const cellType = activeCellDefinition.cellType;
    state.cellConfig = services.cellConfigUseCases.remove(state.cellConfig, cellType);
    closeCellDefinitionDialog();
    rebuildAfterCellConfigChange(`${cellType}: saved Cell Config deleted`);
  }

  async function handleCellConfigImport(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const prepared = services.cellConfigUseCases.prepareImport(state.cellConfig, await file.text());
      if (prepared.conflicts.length && !window.confirm(`Replace ${prepared.conflicts.length} existing Cell Config definition(s): ${prepared.conflicts.join(", ")}?`)) return;
      state.cellConfig = services.cellConfigUseCases.commitImport(prepared);
      rebuildAfterCellConfigChange(`Imported Cell Config ${file.name}: ${Object.keys(prepared.incoming.cells).length} definition(s)`);
    } catch (error) {
      services.logProcess("error", "import", `Cell Config import failed ${file.name}: ${error.message}`, { error, fileName: file.name });
      services.setStatus(`Cell Config import failed ${file.name}: ${error.message}`);
    } finally {
      event.target.value = "";
    }
  }

  function exportCellConfig() {
    services.browserDownload.text(`${serializeCellConfig(state.cellConfig)}\n`, "netlist-cell-config.json", "application/json");
    services.setStatus(`Exported ${Object.keys(state.cellConfig.cells).length} Cell Config definition(s)`);
  }

  function resetAllCellConfig() {
    const count = Object.keys(state.cellConfig.cells).length;
    if (count === 0) return;
    if (!window.confirm(`Remove all ${count} saved Cell Config definition(s)?`)) return;
    state.cellConfig = services.cellConfigUseCases.reset();
    rebuildAfterCellConfigChange("All saved Cell Config definitions reset");
  }

  function rebuildAfterCellConfigChange(message) {
    if (state.compare.active) {
      services.renderCompareGraphs();
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
      }, services.SEARCH_FIRST_NODE_THRESHOLD);
      if (refreshView.viewMode === "focused" || refreshView.viewMode === "search-first") {
        services.replaceSingleFocusedRoots(refreshView.rootNodeIds ||
          (refreshView.coneRootNodeId ? [refreshView.coneRootNodeId] : []));
        if (refreshView.viewMode === "search-first") services.setSingleViewMode("search-first");
      } else {
        services.singleViewSession.dispatch({ type: "focus.clear" });
      }
      services.renderCurrentModuleGraph({
        readyMessage: message,
        onRendered: (graph) => {
          services.setSingleTransform(previousTransform);
          services.setSelectedNode(graph.nodes.some((node) => node.id === selectedNodeId) ? selectedNodeId : null);
          services.applyTransform();
        }
      });
    }
    updateCellDefinitionControls();
    services.setStatus(message);
  }

  function updateCellDefinitionControls(node = null) {
    const selected = node || state.fullGraph?.nodes.find((item) => item.id === state.selectedNodeId);
    elements.editCellDefinitionButton.disabled = !selected || selected.kind !== "cell" || Boolean(selected.referencedModuleName);
    elements.exportCellConfigButton.disabled = Object.keys(state.cellConfig.cells).length === 0;
    elements.resetCellConfigButton.disabled = Object.keys(state.cellConfig.cells).length === 0;
  }

  return Object.freeze({ openSelectedCellDefinition, closeCellDefinitionDialog, saveActiveCellDefinition, deleteActiveCellDefinition, handleCellConfigImport, exportCellConfig, resetAllCellConfig, rebuildAfterCellConfigChange, updateCellDefinitionControls });
}

export const cellConfigPorts = Object.freeze({
  state: [
    "cellConfig", "compare", "coneRootNodeId", "currentModule", "design", "focusedRootNodeIds",
    "fullGraph", "graph", "selectedNodeId", "transform", "viewMode"
  ],
  elements: [
    "cellDefinitionBody", "cellDefinitionDialog", "cellDefinitionForm", "deleteCellDefinitionButton",
    "editCellDefinitionButton", "exportCellConfigButton", "resetCellConfigButton"
  ],
  services: [
    "SEARCH_FIRST_NODE_THRESHOLD", "applyTransform", "browserDownload", "cellConfigUseCases",
    "renderCompareGraphs", "renderCurrentModuleGraph", "replaceSingleFocusedRoots", "setSelectedNode",
    "setSingleTransform", "setSingleViewMode", "setStatus", "logProcess", "singleViewSession"
  ]
});
