import { createSingleViewSessionBridge } from "./single_view_session_bridge.js";
import { createCompareViewSessionBridge } from "./compare_view_session_bridge.js";
import { buildModuleFullGraph } from "./moduleWorkspace.js";
import { normalizeShowPath } from "../contracts/show_path.js";
import { comparePathSnapshot } from "./sessionState.js";
import { copyBrowserText } from "../platform/browser_clipboard.js";
import { bindShowPath } from "../ui/show_path_controller.js";
import { netlistPathContext } from "./show_path_context.js";
import { netPathKey } from "../domains/netlist/show_path.js";
import { createSessionPersistenceController, sessionPersistencePorts } from "./session_persistence_controller.js";
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
import { SINGLE_NAVIGATION_FIELDS, COMPARE_NAVIGATION_FIELDS } from "./view_navigation_import.js";
import { SINGLE_VIEW_STATE_FIELDS, COMPARE_VIEW_STATE_FIELDS } from "./view_state_import.js";
import { createNetRoutingBridge } from "./net_routing_bridge.js";
import { createNetlistStructureBridge } from "./netlist_structure_bridge.js";
import { objectRefToNodeId } from "../domains/netlist/graph_object_refs.js";

export function createViewSessionBridges(state, sessions, onDispatch) {
  const options = { state, sessions, onDispatch, getDocumentId: () => state.document?.documentId || null };
  return { singleViewSession: createSingleViewSessionBridge(options), compareViewSessions: createCompareViewSessionBridge(options) };
}

// Declarative composition. Each adapter owns its explicit legacy capabilities.
export function createWorkbenchControllers({ state, getElements, services, routeAction = (_name, action, args) => action(...args) }) {
  const actions = Object.create(null);
  let structure;
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
  const refreshCompareSelection = () => {
    if (state.compare.active && state.compare.selectedName && state.compare.selectedKind) {
      actions.selectCompareObject(state.compare.selectedKind, state.compare.selectedName, false, state.compare.selectedSide, false);
    }
  };
  function validateSavedPath(value, module, occurrence, graphOverrides = state.graphOverrides) {
    if (!value) return;
    const query = normalizeShowPath(value);
    if (!query) return;
    const full = buildModuleFullGraph({ module, moduleLibrary: state.design.modules, graphOverrides, cellConfig: state.cellConfig,
      cellLibrary: services.readCellLibrary?.(), showAliases: state.showAliases, occurrencePath: occurrence?.occurrencePath });
    services.netlistFeature.pathIndex(full).query({ ...query, enabled: true });
  }
  const wire = (owner, factory, ports) => factory({
    state: createLegacyPort(() => state, ports.state, {
      writable: true,
      readOnly: [...SINGLE_NAVIGATION_FIELDS, ...SINGLE_VIEW_STATE_FIELDS],
      nestedReadOnly: { compare: [...COMPARE_NAVIGATION_FIELDS, ...COMPARE_VIEW_STATE_FIELDS] },
      nestedFields: { compare: COMPARE_FIELDS_BY_CONTROLLER[owner] || [] }
    }),
    elements: createLegacyPort(getElements, ports.elements),
    services: createLegacyPort(() => services, ports.services),
    ...(owner === "search-navigation" ? { comparePathScope(result) {
      if (!state.compare.active) return null;
      const side = [state.compare.selectedSide, "left", "right"].find((s) => s && state.compare.graphs[s]?.moduleName === result?.moduleName);
      const graph = state.compare.graphs[side];
      if (!graph?.path) return null;
      const bridge = services.compareViewSessions;
      const target = result.target;
      const ref = bridge.objectRef(side, target.kind === "port" ? target.direction : target.kind, target.name);
      return { graph, ref, select: () => actions.selectCompareObject(target.kind, target.name, true, side),
        dispatch: (command) => bridge.dispatch(side, command), ready: bridge.isWorkspaceReady,
        rebuild: (options) => actions.renderCompareGraphs({ ...options, onCommitted: options.onRendered }) };
    } } : {}),
    ...(owner === "golden" ? { validateSavedPath, markExport: (markup, side) => structure?.markExport(markup, side) ?? markup } : {}),
    ...(owner === "input" ? { validateSavedPath,
      compareSideActions: {
        setCompareSideTiming: (side, timing, label, opts) => actions.setCompareSideTiming(side, timing, label, opts),
        updateCompareSideTimingControls: () => actions.updateCompareSideTimingControls(),
        applyMergedCompareModules: (opts) => actions.assignCompareSideModule(opts),
        refreshCompareSelection
      },
      restoreComparePath(entry) {
      const compare = entry.compare;
      if (!compare?.showPath) return;
      const showPath = { ...compare.showPath };
      for (const side of ["left", "right"]) {
        const module = state.design.modules.find((item) => item.name === compare[side + "ModuleName"]);
        if (!module) return;
        try { validateSavedPath(showPath[side], module, null, compare.overrides?.[side]?.graphOverrides); }
        catch (error) {
          showPath[side] = null;
          services.logProcess("warning", "persistence", "Saved Show Path could not be restored", {
            operation: "show-path.restore", code: error.code, error, side, documentId: state.document.documentId, moduleName: module.name });
        }
      }
      return actions.restoreViewHistoryEntry({ ...entry, compare: { ...compare, showPath } });
    } } : {}),
    ...(owner === "session-persistence" ? { readComparePath: () => comparePathSnapshot(state),
      canPersist: () => !getElements().canvas?.matches?.(".is-panning,.is-node-dragging,.is-view-interacting")
    } : {}),
    ...(owner === "inspector" ? { netRouting, refreshAnalysis: () => structure?.refresh(),
      inspectAnalysis: (side, id) => structure?.inspect(side, id) } : {}),
    ...(owner === "workspace-render" ? { mounted: (mount) => structure?.refresh(mount) } : {}),
    ...(owner === "cell-config" ? { present: (action) => routeAction("presentCellConfig", action, []) } : {})
  });
  const controllers = [
    ["input", createInputController, inputPorts], ["sidebar", createSidebarController, sidebarPorts],
    ["module-navigation", createModuleNavigationController, moduleNavigationPorts],
    ["compare-workspace", createCompareWorkspaceController, compareWorkspacePorts],
    ["session-persistence", createSessionPersistenceController, sessionPersistencePorts],
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
    elementTarget.compareLeftClearTimingButton?.addEventListener("click", () => actions.clearCompareSideTiming("left", { onCommitted: refreshCompareSelection }));
    elementTarget.compareRightClearTimingButton?.addEventListener("click", () => actions.clearCompareSideTiming("right", { onCommitted: refreshCompareSelection }));
    if (elementTarget.pathPanel) bindShowPath(elementTarget.pathPanel, {
      copyText: (text) => copyBrowserText(text, elementTarget.pathPanel.ownerDocument.defaultView.navigator.clipboard),
      async navigateResult(result, preferred) {
        if (!result?.target || !result.moduleName) return preferred;
        const switchModule = state.currentModule?.name !== result.moduleName;
        if (state.compare.active) {
          const side = [preferred, state.compare.selectedSide, "left", "right"].find((s) => s && state.compare.graphs[s]?.moduleName === result.moduleName);
          if (side) return side;
          actions.exitCompareView({ deferSingleRender: true });
        } else if (!switchModule) return undefined;
        const rendered = await new Promise((resolve, reject) => {
          const callbacks = { onRendered: () => resolve(true), onFailed: reject, onCancelled: () => resolve(false) };
          if (switchModule) actions.selectModule(result.moduleName, callbacks);
          else services.renderCurrentModuleGraph(callbacks);
        });
        return rendered ? undefined : null;
      },
      exportSvg: (side) => actions.exportCurrentSvg(side),
      log: services.logProcess, subscribe: (listener) => services.viewSessions.subscribe(listener),
      read: (preferredSide) => routeAction("readShowPath", () => {
        const side = state.compare.active ? preferredSide || state.compare.selectedSide || "left" : null;
        const sessionId = side ? "compare:" + side : "single:primary";
        const session = services.viewSessions.get(sessionId);
        const graph = side ? state.compare.graphs[side] : state.graph;
        const full = side ? state.compare.fullGraphs[side] : state.fullGraph;
        const ref = session?.selectedObjectRef;
        return netlistPathContext({ document: state.document, session, side, graph, full,
          occurrence: side ? null : state.occurrenceContext?.occurrencePath,
          selectedKey: ref?.kind === "net" ? netPathKey(ref.localId) : side ? ref && objectRefToNodeId(ref, full) : state.selectedNodeId,
          feature: services.netlistFeature, render: side ? services.renderCompareGraphs : services.renderCurrentModuleGraph,
          commit: (candidate) => side ? services.compareViewSessions.setShowPath(side, candidate) : services.singleViewSession.setShowPath(candidate),
          remember: () => services.commitViewHistory({ label: "Show Path", affectedSessionIds: [sessionId] }),
          locate(id) {
            const node = graph.nodes.find((n) => n.id === id);
            if (!node) return;
            const mount = side === "left" ? elementTarget.leftMount : side === "right" ? elementTarget.rightMount : elementTarget.mount;
            if (!side) services.setSelectedNode(id, false);
            services.focusPositionedCell(node, mount, side ? state.compare.transforms[side] : state.transform, (t) => {
              if (side) { services.setCompareTransform(side, t, false); services.applyCompareTransforms(); }
              else { services.setSingleTransform(t); services.applyTransform(); }
            });
          } });
      }, [])
    });
    const panel = elementTarget.netlistAnalysis, detail = elementTarget.netlistAnalysisDetail;
    if (panel && detail) {
      const mountFor = (id) => id === "single" ? elementTarget.mount : id === "left" ? elementTarget.leftMount : elementTarget.rightMount;
      structure = createNetlistStructureBridge({ panel, detail, jobs: services.workspaceJobs,
        feature: services.netlistFeature, logProcess: services.logProcess, inCompare: () => state.compare.active,
        readContext(id) {
          const single = id === "single", sessionId = single ? "single:primary" : "compare:" + id;
          const graph = single ? state.graph : state.compare.graphs[id];
          const unitId = graph?.moduleName;
          const session = services.viewSessions.get(sessionId);
          return { document: state.document, sessionId, unitId, sessionReady: Boolean(session && session.documentId === state.document?.documentId && session.unitId === unitId),
            selectedNode: () => single ? state.selectedNodeId : objectRefToNodeId(session.selectedObjectRef, graph),
            unitKey: JSON.stringify([unitId, single ? state.occurrenceContext?.occurrencePath : null]),
            graph, fullGraph: single ? state.fullGraph : state.compare.fullGraphs[id], mount: mountFor(id) };
        },
        locate(id, bounds) {
          const single = id === "single";
          services.focusPositionedCell(bounds, mountFor(id), single ? state.transform : state.compare.transforms[id], (transform) => {
            if (single) { services.setSingleTransform(transform); services.applyTransform(); }
            else { services.setCompareTransform(id, transform, false); services.applyCompareTransforms(); }
          });
        } });
    }
  });
  const owners = new Map();
  for (const [owner, factory, ports] of controllers) {
    const controller = wire(owner, factory, ports);
    for (const name of Object.keys(ports.historyActions || {})) {
      if (typeof controller[name] !== "function") throw new Error(`Missing history action ${name} for ${owner}`);
    }
    for (const [name, action] of Object.entries(controller)) {
      if (owners.has(name)) throw new Error(`Duplicate controller action ${name}: ${owners.get(name)} and ${owner}`);
      owners.set(name, owner);
      const invoke = ports.historyActions?.[name]
        ? (...args) => args.some((arg) => arg?.historyMode === "restore") ? action(...args)
          : services.runViewHistoryTransaction({ label: ports.historyActions[name] }, () => action(...args))
        : action;
      actions[name] = (...args) => routeAction(name, invoke, args);
    }
  }
  return Object.freeze(actions);
}

const ALL_COMPARE_FIELDS = Object.freeze([
  "active", "showPath", "activeFocusedRootNodeId", "analysis", "autoGraphs", "focusedRootNodeIds", "focusedRootRefs",
  "focusedRootsSynchronized", "fullGraphs", "graphOverrides", "graphs", "layout", "layoutAbortController",
  "leftModuleName", "nodePositions", "nodeSizes", "outputName", "rightModuleName", "scenes", "selectedKind",
  "selectedName", "selectedSide", "sideTiming", "sideTimingLabels", "singleWorkspaceInvalidated", "synchronized", "timingBadgeChoices",
  "timingBadgePositions", "transforms", "wholeRequested", "workspaceIdentity"
]);

const COMPARE_FIELDS_BY_CONTROLLER = Object.freeze({
  "canvas": ["active", "graphs"],
  "cell-config": ["active"],
  "compare-canvas": ["autoGraphs", "focusedRootNodeIds", "focusedRootsSynchronized", "fullGraphs", "graphs", "nodePositions", "nodeSizes", "scenes", "synchronized", "transforms"],
  "compare-workspace": ALL_COMPARE_FIELDS,
  "focus-navigation": ["active", "graphs", "selectedKind", "selectedName", "selectedSide", "synchronized", "transforms"],
  "focused-roots": ["active", "activeFocusedRootNodeId", "focusedRootNodeIds", "focusedRootRefs", "focusedRootsSynchronized", "fullGraphs", "graphs", "outputName", "selectedKind", "selectedName", "selectedSide", "transforms"],
  "golden": ["active", "scenes", "workspaceIdentity", "graphs", "selectedKind", "selectedName", "selectedSide", "singleWorkspaceInvalidated"],
  "helpers": ["graphOverrides", "nodePositions", "nodeSizes"],
  "history": ALL_COMPARE_FIELDS,
  "input": ["active", "layoutAbortController", "leftModuleName", "rightModuleName", "sideTiming", "sideTimingLabels"],
  "inspector": ["active", "analysis", "fullGraphs", "graphs", "leftModuleName", "rightModuleName", "selectedKind", "selectedName", "selectedSide", "timingBadgeChoices", "timingBadgePositions", "transforms"],
  "module-navigation": ["active"],
  "presentation": ["active", "graphs", "scenes"],
  "selection-navigation": ["active", "graphs", "selectedSide"],
  "state-commands": ["graphOverrides", "nodePositions", "nodeSizes"],
  "view-controls": ["active", "focusedRootNodeIds", "outputName", "selectedKind", "selectedName"],
  "workspace-render": ["active", "singleWorkspaceInvalidated"]
});

const OBJECT_SERVICE_KEYS = new Set([
  "browserDownload", "cellConfigUseCases", "compareViewSessions", "documents", "importRequests", "layoutSpacingController",
  "moduleHierarchyController", "netlistFeature", "processLogController", "renderGeneration",
  "schematicSelectionController", "singleViewSession", "timingDisplayController",
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
