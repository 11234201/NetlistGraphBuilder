import { createInputController, inputPorts } from "./input_controller.js";
import { createSidebarController, sidebarPorts } from "./sidebar_controller.js";
import { createModuleNavigationController, moduleNavigationPorts } from "./module_navigation_controller.js";
import { createCompareWorkspaceController, compareWorkspacePorts } from "./compare_workspace_controller.js";
import { createHistoryController, historyPorts } from "./history_controller.js";
import { createWorkspaceRenderController, workspaceRenderPorts } from "./workspace_render_controller.js";
import { createViewControlsController, viewControlsPorts } from "./view_controls_controller.js";
import { createFocusedRootsController, focusedRootsPorts } from "./focused_roots_controller.js";
import { createFocusNavigationController, focusNavigationPorts } from "./focus_navigation_controller.js";
import { createPresentationController, presentationPorts } from "./presentation_controller.js";
import { createCellConfigController, cellConfigPorts } from "./cell_config_controller.js";
import {
  createSelectionNavigationController,
  selectionNavigationPorts
} from "./selection_navigation_controller.js";
import { createSearchNavigationController, searchNavigationPorts } from "./search_navigation_controller.js";
import { createInspectorController, inspectorPorts } from "./inspector_controller.js";
import { createCanvasController, canvasPorts } from "./canvas_controller.js";
import { createGoldenController, goldenPorts } from "./golden_controller.js";
import { createStateCommandsController, stateCommandsPorts } from "./state_commands_controller.js";
import { createCompareCanvasController, compareCanvasPorts } from "./compare_canvas_controller.js";
import { createStatusController, statusPorts } from "./status_controller.js";
import { createPreferencesController, preferencesPorts } from "./preferences_controller.js";
import { createHelpersController, helpersPorts } from "./helpers_controller.js";
import { createLegacyPort } from "./legacy_port.js";
import { createNetRoutingBridge } from "./net_routing_bridge.js";

// Declarative composition. Each adapter owns its explicit legacy capabilities.
export function createWorkbenchControllers({ state, getElements, services }) {
  const actions = Object.create(null);
  const netRouting = createNetRoutingBridge({
    readContext: (side) => ({
      fullGraph: side ? state.compare.fullGraphs[side] : state.fullGraph,
      graphOverrides: side ? state.compare.graphOverrides[side] : state.graphOverrides
    }),
    updateOverrides: (side, update) => side
      ? actions.updateCompareOverrides(side, update) : actions.updateSingleOverrides(update),
    rebuild: (side) => side ? actions.renderCompareGraphs() : actions.renderCurrentModuleGraph({
      onRendered: () => state.selectedNet
        ? actions.setSelectedNet(state.selectedNet, false)
        : actions.setSelectedNode(state.selectedNodeId, false)
    })
  });
  const wire = (owner, factory, ports) => factory({
    state: createLegacyPort(() => state, ports.state, {
      writable: true,
      nestedFields: { compare: COMPARE_FIELDS_BY_CONTROLLER[owner] || [] }
    }),
    elements: createLegacyPort(getElements, ports.elements),
    services: createLegacyPort(() => services, ports.services),
    ...(owner === "inspector" ? { netRouting } : {})
  });
  const controllers = [
    ["input", createInputController, inputPorts], ["sidebar", createSidebarController, sidebarPorts],
    ["module-navigation", createModuleNavigationController, moduleNavigationPorts],
    ["compare-workspace", createCompareWorkspaceController, compareWorkspacePorts],
    ["history", createHistoryController, historyPorts], ["workspace-render", createWorkspaceRenderController, workspaceRenderPorts],
    ["view-controls", createViewControlsController, viewControlsPorts], ["focused-roots", createFocusedRootsController, focusedRootsPorts],
    ["focus-navigation", createFocusNavigationController, focusNavigationPorts], ["presentation", createPresentationController, presentationPorts],
    ["cell-config", createCellConfigController, cellConfigPorts], ["selection-navigation", createSelectionNavigationController, selectionNavigationPorts],
    ["search-navigation", createSearchNavigationController, searchNavigationPorts], ["inspector", createInspectorController, inspectorPorts],
    ["canvas", createCanvasController, canvasPorts], ["golden", createGoldenController, goldenPorts],
    ["state-commands", createStateCommandsController, stateCommandsPorts], ["compare-canvas", createCompareCanvasController, compareCanvasPorts],
    ["status", createStatusController, statusPorts], ["preferences", createPreferencesController, preferencesPorts],
    ["helpers", createHelpersController, helpersPorts]
  ];
  for (const [owner, , ports] of controllers) {
    for (const key of ports.state) if (!(key in state)) throw new Error(`Missing state dependency ${key} for ${owner}`);
    for (const key of ports.services) if (!(key in services)) throw new Error(`Missing service dependency ${key} for ${owner}`);
  }
  queueMicrotask(() => {
    const elementTarget = getElements();
    for (const [owner, , ports] of controllers) {
      for (const key of ports.elements) if (!(key in elementTarget)) throw new Error(`Missing element dependency ${key} for ${owner}`);
      for (const key of ports.services) validateWorkbenchServiceDependency(services, key, owner);
    }
  });
  const owners = new Map();
  for (const [owner, factory, ports] of controllers) {
    for (const [name, action] of Object.entries(wire(owner, factory, ports))) {
      if (owners.has(name)) throw new Error(`Duplicate controller action ${name}: ${owners.get(name)} and ${owner}`);
      owners.set(name, owner);
      actions[name] = action;
    }
  }
  return Object.freeze(actions);
}

const ALL_COMPARE_FIELDS = Object.freeze([
  "active", "activeFocusedRootNodeId", "analysis", "autoGraphs", "focusedRootNodeIds", "focusedRootRefs",
  "focusedRootsSynchronized", "fullGraphs", "graphOverrides", "graphs", "layout", "layoutAbortController",
  "leftModuleName", "nodePositions", "nodeSizes", "outputName", "rightModuleName", "scenes", "selectedKind",
  "selectedName", "selectedSide", "singleWorkspaceInvalidated", "synchronized", "timingBadgeChoices",
  "timingBadgePositions", "transforms", "wholeRequested", "workspaceIdentity"
]);

const COMPARE_FIELDS_BY_CONTROLLER = Object.freeze({
  "canvas": ["active", "graphs"],
  "cell-config": ["active"],
  "compare-canvas": ["autoGraphs", "focusedRootNodeIds", "focusedRootsSynchronized", "fullGraphs", "graphs", "nodePositions", "nodeSizes", "scenes", "synchronized", "transforms"],
  "compare-workspace": ALL_COMPARE_FIELDS,
  "focus-navigation": ["active", "graphs", "selectedKind", "selectedName", "selectedSide", "synchronized", "transforms"],
  "focused-roots": ["active", "activeFocusedRootNodeId", "focusedRootNodeIds", "focusedRootRefs", "focusedRootsSynchronized", "fullGraphs", "graphs", "outputName", "selectedKind", "selectedName", "selectedSide", "transforms"],
  "golden": ["active", "graphs", "selectedKind", "selectedName", "selectedSide", "singleWorkspaceInvalidated"],
  "helpers": ["graphOverrides", "nodePositions", "nodeSizes"],
  "history": ALL_COMPARE_FIELDS,
  "input": ["active", "layoutAbortController"],
  "inspector": ["active", "analysis", "fullGraphs", "graphs", "selectedKind", "selectedName", "selectedSide", "timingBadgeChoices", "timingBadgePositions", "transforms"],
  "module-navigation": ["active"],
  "presentation": ["active", "graphs", "scenes"],
  "selection-navigation": ["active", "graphs", "selectedSide"],
  "state-commands": ["graphOverrides", "nodePositions", "nodeSizes"],
  "view-controls": ["active", "focusedRootNodeIds", "outputName", "selectedKind", "selectedName"],
  "workspace-render": ["active", "singleWorkspaceInvalidated"]
});

const OBJECT_SERVICE_KEYS = new Set([
  "browserDownload", "cellConfigUseCases", "compareViewSessions", "documents", "layoutSpacingController",
  "moduleHierarchyController", "netlistFeature", "processLogController", "renderGeneration",
  "schematicSelectionController", "singleViewSession", "timingDisplayController", "viewHistoryTransactions",
  "viewSessions", "wheelGestureController", "workspaceExecution", "workspaceJobs"
]);

export function validateWorkbenchServiceDependency(services, key, owner) {
  const value = services[key];
  const expected = key === "SEARCH_FIRST_NODE_THRESHOLD" ? "number" : OBJECT_SERVICE_KEYS.has(key) ? "object" : "function";
  if ((expected === "object" && (!value || typeof value !== "object")) ||
      (expected !== "object" && typeof value !== expected)) {
    throw new Error(`Invalid service dependency ${key} for ${owner}: expected ${expected}`);
  }
}
