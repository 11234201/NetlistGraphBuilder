import { renderOccurrenceChoices } from "../ui/occurrence_choice_panel.js";
import { findModuleOccurrences, buildModuleHierarchy } from "../domains/netlist/module_hierarchy.js";
import { shouldUseSearchFirst } from "./graphWorkspace.js";
import { saveModuleWorkspace, restoreModuleWorkspace } from "./appState.js";

// Legacy workbench adapter. State and elements are restricted ports supplied
// by the composition root; peer actions are explicit, late-bound services.
export function createModuleNavigationController({ state, elements, services }) {
  function renderModuleOptions() {
    elements.moduleHierarchyFilter.value = "";
    renderOccurrenceChoicePanel([], "");
    updateModuleHierarchyPicker();
    services.renderCompareModuleOptions();
    renderModuleHierarchy();
  }

  function renderModuleHierarchy() {
    services.moduleHierarchyController.render();
  }

  function renderOccurrenceChoicePanel(occurrences, moduleName) {
    elements.moduleOccurrenceChoices.innerHTML = renderOccurrenceChoices(occurrences, moduleName);
  }

  function handleOccurrenceChoiceClick(event) {
    const button = event.target.closest?.("[data-occurrence-module]");
    if (!button) return;
    const occurrencePath = button.dataset.occurrencePath?.split("/").filter(Boolean) || [];
    if (!occurrencePath.length) return;
    event.preventDefault();
    selectModule(button.dataset.occurrenceModule, {
      occurrencePath,
      rootModuleName: button.dataset.occurrenceRoot
    });
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

  function selectModule(moduleName, options = {}) {
    const module = state.design.modules.find((item) => item.name === moduleName);
    if (!module) {
      return;
    }
    const hasExplicitOccurrencePath = Array.isArray(options.occurrencePath);
    const ambiguousOccurrences = !hasExplicitOccurrencePath
      ? findModuleOccurrences(buildModuleHierarchy(state.design), module.name)
      : [];
    const switchingModule = state.currentModule?.name !== module.name;
    const defaultViewMode = shouldUseSearchFirst(module, services.SEARCH_FIRST_NODE_THRESHOLD) ? "search-first" : "whole";
    if (state.currentModule && switchingModule) {
      saveModuleWorkspace(state, state.currentModule.name);
      services.singleViewSession.dispatch({
        type: "unit.set",
        unitId: module.name,
        viewMode: defaultViewMode
      });
    }
    state.currentModule = module;
    if (switchingModule && !hasExplicitOccurrencePath) state.occurrenceContext = null;
    if (switchingModule) services.logProcess("info", "navigation", `Opened module ${module.displayName}`, { moduleName: module.name });
    const restoredWorkspace = switchingModule && restoreModuleWorkspace(state, module.name);
    if (hasExplicitOccurrencePath) {
      state.occurrenceContext = options.occurrencePath.length
        ? {
          rootModuleName: options.rootModuleName || state.occurrenceContext?.rootModuleName || module.name,
          occurrencePath: [...options.occurrencePath]
        }
        : null;
    }
    renderOccurrenceChoicePanel(
      !state.occurrenceContext ? ambiguousOccurrences : [],
      module.name
    );
    updateModuleHierarchyPicker();
    renderModuleHierarchy();
    if (switchingModule && !restoredWorkspace) state.viewMode = defaultViewMode;
    services.setSingleTransform({ x: 0, y: 0, scale: 1 });
    const requestedOnRendered = options.onRendered;
    if (!options.deferRender) {
      services.renderCurrentModuleGraph({
        ...options,
        onRendered: (graph) => {
          requestedOnRendered?.(graph);
          if (ambiguousOccurrences.length > 1 && !state.occurrenceContext) {
            services.setStatus(`${module.displayName} has ${ambiguousOccurrences.length} hierarchy occurrences; choose one from Module hierarchy`);
          }
        }
      });
    }
    if (!options.deferRender) services.renderStats();
    services.renderDiagnostics();
    services.renderSelection(null);
    services.updateViewControls();
    services.applyTransform();
    if (options.historyMode !== "restore") services.recordViewHistory();
  }

  return Object.freeze({ renderModuleOptions, renderModuleHierarchy, renderOccurrenceChoicePanel, handleOccurrenceChoiceClick, updateModuleHierarchyPicker, selectModule });
}

export const moduleNavigationPorts = Object.freeze({
  state: [
    "activeFocusedRootNodeId", "activeSearchResult", "autoGraph", "compare", "compareWorkspaces",
    "coneRootNodeId", "currentModule", "design", "expandedGroupIds", "faninDepth", "fanoutDepth",
    "focusedRootNodeIds", "focusedRootRefs", "fullGraph", "graph", "graphOverrides", "moduleWorkspaces",
    "nodePositions", "nodeSizes", "occurrenceContext", "restoringViewHistory", "scene", "searchResults",
    "selectedNet", "selectedNodeId", "timing", "timingBadgeChoices", "timingBadgePositions",
    "viewHistory", "viewMode", "workspaceArtifactCache"
  ],
  elements: [
    "moduleHierarchyCurrent", "moduleHierarchyFilter", "moduleHierarchyMenu", "moduleHierarchySummary",
    "moduleOccurrenceChoices"
  ],
  services: [
    "SEARCH_FIRST_NODE_THRESHOLD", "applyTransform", "logProcess", "moduleHierarchyController",
    "recordViewHistory", "renderCompareModuleOptions", "renderCurrentModuleGraph", "renderDiagnostics",
    "renderSelection", "renderStats", "setSingleTransform", "setStatus", "singleViewSession",
    "updateViewControls"
  ]
});
