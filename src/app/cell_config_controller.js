import {
  renderCellDefinitionEditor,
  readCellDefinitionEditor
} from "../ui/cellDefinitionPanel.js";
import { collectCellTypeSummary, createInferredCellDefinition } from "../domains/netlist/cell_definition_query.js";
import { serializeCellConfig } from "../infer/cellConfig.js";
import { resolveCellConfigRefreshView } from "./graphWorkspace.js";
import { errorMessage } from "../foundation/log_details.js";

// Legacy workbench adapter. State and elements are restricted ports supplied
// by the composition root; peer actions are explicit, late-bound services.
export function createCellConfigController({ state, elements, services, present = (action) => action() }) {
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
    openEditor(node.ref?.type);
  }

  function openEditor(cellType) {
    activeCellDefinition = collectCellTypeSummary(state.design, cellType);
    const saved = state.cellConfig.cells[activeCellDefinition.cellType];
    const definition = saved || createInferredCellDefinition(activeCellDefinition);
    if (saved) {
      activeCellDefinition.displayName = saved.displayName || activeCellDefinition.displayName;
      const connected = new Set(activeCellDefinition.pins.map(pin => pin.canonicalName));
      for (const name of Object.keys(saved.pins).sort()) {
        if (!connected.has(name)) activeCellDefinition.pins.push({name,canonicalName:name,count:0});
      }
    }
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
    const cellType = activeCellDefinition.cellType;
    commitConfigChange("save-cell-config", () => services.cellConfigUseCases.set(state.cellConfig, cellType,
      readCellDefinitionEditor(elements.cellDefinitionForm, activeCellDefinition)),
      `${cellType}: Cell Config saved`, { cellType }, true);
  }

  function deleteActiveCellDefinition() {
    if (!activeCellDefinition) return;
    const cellType = activeCellDefinition.cellType;
    commitConfigChange("delete-cell-config", () => services.cellConfigUseCases.remove(state.cellConfig, cellType),
      `${cellType}: saved Cell Config deleted`, { cellType }, true);
  }

  async function handleCellConfigImport(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const source = await file.text();
      const prepared = services.cellConfigUseCases.prepareImport(state.cellConfig, source);
      if (prepared.conflicts.length) {
        const confirmed = present(() => window.confirm(`Replace ${prepared.conflicts.length} existing Cell Config definition(s): ${prepared.conflicts.join(", ")}?`));
        if (confirmed === undefined) services.logProcess("warning", "import", `Cell Config ${file.name} requires confirmation in the Netlist workspace; definitions were not changed`, { fileName: file.name });
        if (!confirmed) return;
      }
      commitConfigChange("import-cell-config", () => services.cellConfigUseCases.commitImport(prepared),
        `Imported Cell Config ${file.name}: ${Object.keys(prepared.incoming.cells).length} definition(s)`, { fileName: file.name });
    } catch (error) {
      reportFailure(error, "import", `Cell Config import failed ${file.name}`, { operation: "prepare-cell-config-import", fileName: file.name });
    } finally {
      event.target.value = "";
    }
  }

  function exportCellConfig() {
    const fileName = "netlist-cell-config.json";
    try {
      services.browserDownload.text(`${serializeCellConfig(state.cellConfig)}\n`, fileName, "application/json");
      const message = `Exported ${Object.keys(state.cellConfig.cells).length} Cell Config definition(s)`;
      services.logProcess("info", "export", message, { operation: "export-cell-config", fileName });
      services.setStatus(message);
    } catch (error) {
      reportFailure(error, "export", "Cell Config export failed", { operation: "export-cell-config", fileName });
    }
  }

  function resetAllCellConfig() {
    const count = Object.keys(state.cellConfig.cells).length;
    if (count === 0) return;
    if (!window.confirm(`Remove all ${count} saved Cell Config definition(s)?`)) return;
    commitConfigChange("reset-cell-config", () => services.cellConfigUseCases.reset(),
      "All saved Cell Config definitions reset", { definitionCount: count });
  }

  function reportFailure(error, phase, label, details) {
    const message = `${label}: ${errorMessage(error)}`;
    services.logProcess("error", phase, message, { error, ...details });
    present(() => services.setStatus(message));
  }

  function commitConfigChange(operation, commit, message, details, closeEditor = false, strict = false) {
    try {
      state.cellConfig = commit();
    } catch (error) {
      if (strict) throw error;
      reportFailure(error, "persistence", "Cell Config change could not be saved", { operation, ...details });
      return;
    }
    services.logProcess("info", "persistence", message, { operation, ...details });
    try {
      present(() => {
        if (closeEditor) closeCellDefinitionDialog();
        rebuildAfterCellConfigChange(message);
      });
    } catch (error) {
      if (strict) throw error;
      reportFailure(error, "render", "Cell Config saved, but workspace refresh failed", { operation, ...details });
    }
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

  function runCellConfigCommand({name, args, opts}) {
    const fail = (code, message) => { throw Object.assign(new Error(message), {code}); };
    const scope = "browser-origin";
    const type = args[0];
    if (name === "cell-config export")
      return {text:serializeCellConfig(state.cellConfig) + "\n", name:"netlist-cell-config.json", mime:"application/json"};
    if (name === "cell-config show" || name === "cell-config edit") {
      const summary = collectCellTypeSummary(state.design, type);
      if (state.design?.modules.some(module => module.name === type)) fail("INVALID_CELL_TYPE", "Module definitions cannot be replaced");
      const saved = Object.hasOwn(state.cellConfig.cells, summary.cellType) ? state.cellConfig.cells[summary.cellType] : null;
      if (!summary.instanceCount && !saved) fail("CELL_TYPE_NOT_FOUND", "Unknown cell type");
      if (name === "cell-config edit") openEditor(type);
      return {scope, type:summary.cellType, saved, definition:saved || createInferredCellDefinition(summary), instances:summary.instanceCount};
    }
    if (name === "cell-config delete" || name === "cell-config reset") {
      if (name.endsWith("reset") && !opts.confirm) fail("CONFIRM_REQUIRED", "Use --confirm to reset all cell definitions");
      if (type && !Object.hasOwn(state.cellConfig.cells,type)) fail("CELL_TYPE_NOT_FOUND","No saved definition for this type");
      commitConfigChange(name, () => type ? services.cellConfigUseCases.remove(state.cellConfig, type) : services.cellConfigUseCases.reset(),
        type ? "Deleted saved cell definition" : "Reset saved cell definitions", {cellType:type}, true, true);
      return {scope, savedCount:Object.keys(state.cellConfig.cells).length};
    }
    if (!activeCellDefinition || !elements.cellDefinitionDialog.open) fail("EDITOR_CLOSED", "Open a cell definition first");
    if (name === "cell-config cancel") { closeCellDefinitionDialog(); return {cancelled:true}; }
    const form = elements.cellDefinitionForm;
    if (name === "cell-config gate" || name === "cell-config pin") {
      const gate = name.endsWith("gate");
      const select = gate ? form.querySelector("#cellDefinitionGateKind") :
        [...form.querySelectorAll("[data-cell-config-pin]")].find(item => item.dataset.cellConfigPin === args[0]);
      const value = args[gate ? 0 : 1];
      if (!select || ![...select.options].some(option => option.value === value)) fail("INVALID_ARGUMENT","Unknown pin or editor value");
      select.value = value;
    }
    const cellType = activeCellDefinition.cellType;
    const definition = readCellDefinitionEditor(form,activeCellDefinition);
    if (name === "cell-config save")
      commitConfigChange(name, () => services.cellConfigUseCases.set(state.cellConfig,cellType,definition),
        "Saved cell definition", {cellType}, true, true);
    return {scope, type:cellType, definition};
  }
  return Object.freeze({ runCellConfigCommand, openSelectedCellDefinition, closeCellDefinitionDialog, saveActiveCellDefinition, deleteActiveCellDefinition, handleCellConfigImport, exportCellConfig, resetAllCellConfig, rebuildAfterCellConfigChange, updateCellDefinitionControls });
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
