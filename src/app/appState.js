import { createModuleHistory } from "./moduleHistory.js";
import { normalizeSingleViewMode } from "./singleViewMode.js";
import { normalizeFocusedRootNodeIds as normalizePolicyRoots } from "./focusedViewPolicy.js";
import { resolveFocusedRootState } from "./focusedSelection.js";

export function createAppState(layoutPolicy) {
  return {
    design: null,
    document: null,
    currentSource: null,
    currentSourceLabel: null,
    currentModule: null,
    fullGraph: null,
    autoGraph: null,
    graph: null,
    scene: null,
    transform: { x: 0, y: 0, scale: 1 },
    selectedNodeId: null,
    selectedNet: null,
    viewMode: "whole",
    coneRootNodeId: null,
    focusedRootNodeIds: [],
    activeFocusedRootNodeId: null,
    coneDepth: 3,
    faninDepth: 3,
    fanoutDepth: 3,
    showAliases: false,
    useFanoutHubs: true,
    collapseLargeGroups: false,
    expandedGroupIds: new Set(),
    searchIndex: [],
    searchQuery: "",
    searchResults: [],
    activeSearchResult: -1,
    nodePositions: new Map(),
    nodeSizes: new Map(),
    graphOverrides: createEmptyGraphOverrides(),
    cellConfig: { kind: "netlist-cell-config", version: 1, cells: {} },
    timing: null,
    timingDisplayPolicy: { snapshot: "auto", metrics: ["slack"] },
    timingBadgeChoices: {},
    timingBadgePositions: {},
    calibrationMode: false,
    layoutProviderId: "simple-layered",
    layoutRequestId: 0,
    selectionFocusRequestId: 0,
    layoutPolicy: cloneLayoutPolicy(layoutPolicy),
    moduleWorkspaces: new Map(),
    moduleHistory: createModuleHistory(),
    compareWorkspaces: new Map(),
    compare: createCompareState()
  };
}

export function createCompareState() {
  return {
    active: false,
    leftModuleName: null,
    rightModuleName: null,
    graphs: { left: null, right: null },
    scenes: { left: null, right: null },
    autoGraphs: { left: null, right: null },
    fullGraphs: { left: null, right: null },
    transforms: {
      left: { x: 0, y: 0, scale: 1 },
      right: { x: 0, y: 0, scale: 1 }
    },
    synchronized: true,
    focusedRootsSynchronized: true,
    layout: "vertical",
    selectedName: null,
    selectedKind: null,
    selectedSide: null,
    nodePositions: { left: new Map(), right: new Map() },
    nodeSizes: { left: new Map(), right: new Map() },
    graphOverrides: { left: createEmptyGraphOverrides(), right: createEmptyGraphOverrides() },
    timingBadgeChoices: { left: {}, right: {} },
    timingBadgePositions: { left: {}, right: {} },
    outputName: null,
    focusedRootNodeIds: { left: [], right: [] },
    activeFocusedRootNodeId: { left: null, right: null },
    analysis: null
  };
}

export function resetDesignWorkspace(state) {
  resetModuleWorkspace(state);
  state.fullGraph = null;
  state.autoGraph = null;
  state.graph = null;
  state.scene = null;
  state.selectedNodeId = null;
  state.selectedNet = null;
  state.searchResults = [];
  state.activeSearchResult = -1;
  state.timing = null;
  state.moduleWorkspaces = new Map();
  state.moduleHistory = createModuleHistory();
  state.compareWorkspaces = new Map();
}

export function saveModuleWorkspace(state, moduleName) {
  if (!moduleName) return;
  state.moduleWorkspaces.set(moduleName, {
    nodePositions: new Map(state.nodePositions),
    nodeSizes: new Map(state.nodeSizes),
    graphOverrides: cloneGraphOverrides(state.graphOverrides),
    viewMode: state.viewMode,
    coneRootNodeId: state.coneRootNodeId,
    focusedRootNodeIds: normalizeFocusedRootNodeIds(state.focusedRootNodeIds, state.coneRootNodeId),
    activeFocusedRootNodeId: state.activeFocusedRootNodeId,
    faninDepth: state.faninDepth,
    fanoutDepth: state.fanoutDepth,
    timingBadgeChoices: cloneRecord(state.timingBadgeChoices),
    timingBadgePositions: { ...state.timingBadgePositions }
  });
}

export function restoreModuleWorkspace(state, moduleName) {
  const saved = state.moduleWorkspaces.get(moduleName);
  resetModuleWorkspace(state);
  if (!saved) return false;
  state.nodePositions = new Map(saved.nodePositions);
  state.nodeSizes = new Map(saved.nodeSizes);
  state.graphOverrides = cloneGraphOverrides(saved.graphOverrides);
  state.viewMode = normalizeSingleViewMode(saved.viewMode);
  state.focusedRootNodeIds = normalizeFocusedRootNodeIds(saved.focusedRootNodeIds, saved.coneRootNodeId);
  state.coneRootNodeId = state.focusedRootNodeIds[0] || null;
  state.activeFocusedRootNodeId = state.focusedRootNodeIds.includes(saved.activeFocusedRootNodeId)
    ? saved.activeFocusedRootNodeId
    : state.coneRootNodeId;
  state.faninDepth = normalizeDepth(saved.faninDepth, state.faninDepth);
  state.fanoutDepth = normalizeDepth(saved.fanoutDepth, state.fanoutDepth);
  state.timingBadgeChoices = cloneRecord(saved.timingBadgeChoices);
  state.timingBadgePositions = { ...saved.timingBadgePositions };
  return true;
}

export function saveCompareWorkspace(state) {
  const key = compareWorkspaceKey(state.compare.leftModuleName, state.compare.rightModuleName);
  if (!key) return;
  state.compareWorkspaces.set(key, cloneCompareAdjustments(state.compare));
}

export function restoreCompareWorkspace(state, leftModuleName, rightModuleName) {
  const saved = state.compareWorkspaces.get(compareWorkspaceKey(leftModuleName, rightModuleName));
  const fresh = saved || createCompareState();
  state.compare.nodePositions = cloneSideMaps(fresh.nodePositions);
  state.compare.nodeSizes = cloneSideMaps(fresh.nodeSizes);
  state.compare.graphOverrides = {
    left: cloneGraphOverrides(fresh.graphOverrides.left),
    right: cloneGraphOverrides(fresh.graphOverrides.right)
  };
  state.compare.timingBadgeChoices = {
    left: cloneRecord(fresh.timingBadgeChoices.left),
    right: cloneRecord(fresh.timingBadgeChoices.right)
  };
  state.compare.timingBadgePositions = {
    left: { ...fresh.timingBadgePositions.left },
    right: { ...fresh.timingBadgePositions.right }
  };
  state.compare.focusedRootNodeIds = {
    left: normalizeFocusedRootNodeIds(fresh.focusedRootNodeIds?.left),
    right: normalizeFocusedRootNodeIds(fresh.focusedRootNodeIds?.right)
  };
  state.compare.activeFocusedRootNodeId = {
    left: fresh.activeFocusedRootNodeId?.left || state.compare.focusedRootNodeIds.left[0] || null,
    right: fresh.activeFocusedRootNodeId?.right || state.compare.focusedRootNodeIds.right[0] || null
  };
  state.compare.focusedRootsSynchronized = fresh.focusedRootsSynchronized !== false;
  return Boolean(saved);
}

export function resetModuleWorkspace(state) {
  state.nodePositions = new Map();
  state.nodeSizes = new Map();
  state.graphOverrides = createEmptyGraphOverrides();
  state.expandedGroupIds = new Set();
  state.viewMode = "whole";
  state.coneRootNodeId = null;
  state.focusedRootNodeIds = [];
  state.activeFocusedRootNodeId = null;
  resetTimingPresentation(state);
}

export function resetTimingPresentation(state) {
  state.timingBadgeChoices = {};
  state.timingBadgePositions = {};
}

export function createEmptyGraphOverrides() {
  return {
    nodeProperties: {},
    cellPinDirections: {}
  };
}

function compareWorkspaceKey(left, right) {
  return left && right ? `${left}\u0000${right}` : null;
}

function cloneCompareAdjustments(compare) {
  return {
    nodePositions: cloneSideMaps(compare.nodePositions),
    nodeSizes: cloneSideMaps(compare.nodeSizes),
    graphOverrides: {
      left: cloneGraphOverrides(compare.graphOverrides.left),
      right: cloneGraphOverrides(compare.graphOverrides.right)
    },
    timingBadgeChoices: {
      left: cloneRecord(compare.timingBadgeChoices.left),
      right: cloneRecord(compare.timingBadgeChoices.right)
    },
    timingBadgePositions: {
      left: { ...compare.timingBadgePositions.left },
      right: { ...compare.timingBadgePositions.right }
    },
    focusedRootNodeIds: {
      left: normalizeFocusedRootNodeIds(compare.focusedRootNodeIds?.left),
      right: normalizeFocusedRootNodeIds(compare.focusedRootNodeIds?.right)
    },
    activeFocusedRootNodeId: {
      left: compare.activeFocusedRootNodeId?.left || null,
      right: compare.activeFocusedRootNodeId?.right || null
    },
    focusedRootsSynchronized: compare.focusedRootsSynchronized !== false
  };
}

function cloneSideMaps(value) {
  return { left: new Map(value.left), right: new Map(value.right) };
}

function cloneGraphOverrides(value = createEmptyGraphOverrides()) {
  return {
    nodeProperties: cloneRecord(value.nodeProperties),
    cellPinDirections: cloneRecord(value.cellPinDirections)
  };
}

function cloneRecord(value = {}) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    Array.isArray(item) ? item.map((entry) => ({ ...entry })) : { ...item }
  ]));
}

function cloneLayoutPolicy(policy) {
  return {
    name: policy.name,
    spacing: { ...policy.spacing },
    features: { ...policy.features }
  };
}

function normalizeDepth(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
}

export function normalizeFocusedRootNodeIds(value, legacyRootNodeId = null) {
  return normalizePolicyRoots(value, legacyRootNodeId);
}

export function setFocusedRootNodeIds(state, value, activeRootNodeId = null) {
  const resolved = resolveFocusedRootState(value, activeRootNodeId, state.activeFocusedRootNodeId);
  state.focusedRootNodeIds = resolved.rootNodeIds;
  state.coneRootNodeId = state.focusedRootNodeIds[0] || null;
  state.activeFocusedRootNodeId = resolved.activeRootNodeId;
  return state.focusedRootNodeIds;
}
