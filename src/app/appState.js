import { cloneObjectRefs } from "../contracts/object_ref.js";
import { normalizeSingleViewMode } from "./singleViewMode.js";
import { cloneGraphOverrides } from "../domains/netlist/graph_overrides.js";
import { DEFAULT_LAYOUT_PROVIDER_ID } from "../layout/providerDefaults.js";
import { normalizeFocusedRootNodeIds as normalizePolicyRoots } from "./focusedViewPolicy.js";
import { resolveFocusedRootState } from "./focusedSelection.js";
import { createViewHistory } from "./viewHistory.js";
import { createWorkspaceArtifactCache } from "./workspaceArtifactCache.js";

export function createAppState(layoutPolicy) {
  return {
    design: null,
    document: null,
    currentSource: null,
    currentSourceLabel: null,
    sourceIdentity: null,
    currentModule: null,
    fullGraph: null,
    autoGraph: null,
    graph: null,
    scene: null,
    singleWorkspaceIdentity: null,
    transform: { x: 0, y: 0, scale: 1 },
    selectedNodeId: null,
    selectedNet: null,
    viewMode: "whole",
    coneRootNodeId: null,
    showPath: null,
    focusedRootNodeIds: [],
    focusedRootRefs: [],
    activeFocusedRootNodeId: null,
    occurrenceContext: null,
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
    timingDisplayPolicy: { metrics: ["slack"], threshold: 0.0 },
    timingBadgeChoices: {},
    timingBadgePositions: {},
    calibrationMode: false,
    layoutProviderId: DEFAULT_LAYOUT_PROVIDER_ID,
    layoutFallbackFromProviderId: null,
    layoutRequestId: 0,
    selectionFocusRequestId: 0,
    layoutPolicy: cloneLayoutPolicy(layoutPolicy),
    presentationPolicy: { gateSymbolMode: "rectangle" },
    moduleWorkspaces: new Map(),
    viewHistory: createViewHistory(),
    restoringViewHistory: false,
    pendingViewCommandMetadata: null,
    compareWorkspaces: new Map(),
    workspaceArtifactCache: createWorkspaceArtifactCache(),
    compare: createCompareState()
  };
}

export function createCompareState() {
  return Object.preventExtensions({
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
    wholeRequested: false,
    showPath: { left: null, right: null },
    focusedRootNodeIds: { left: [], right: [] },
    focusedRootRefs: { left: [], right: [] },
    activeFocusedRootNodeId: { left: null, right: null },
    analysis: null,
    singleWorkspaceInvalidated: false,
    layoutAbortController: null,
    workspaceIdentity: null
  });
}

export function resetDesignWorkspace(state, resetNavigation = (value) => Object.assign(state, value)) {
  state.compare?.layoutAbortController?.abort();
  state.compare = createCompareState();
  resetModuleWorkspace(state, resetNavigation);
  state.fullGraph = null;
  state.autoGraph = null;
  state.graph = null;
  state.scene = null;
  state.singleWorkspaceIdentity = null;
  state.searchResults = [];
  state.activeSearchResult = -1;
  state.timing = null;
  state.moduleWorkspaces = new Map();
  state.viewHistory = createViewHistory();
  state.restoringViewHistory = false;
  state.compareWorkspaces = new Map();
  state.workspaceArtifactCache.clear();
}

export function saveModuleWorkspace(state, moduleName) {
  if (!moduleName) return;
  state.moduleWorkspaces.set(moduleName, {
    nodePositions: new Map(state.nodePositions),
    nodeSizes: new Map(state.nodeSizes),
    graphOverrides: cloneGraphOverrides(state.graphOverrides),
    showPath: state.showPath,
    viewMode: state.viewMode,
    coneRootNodeId: state.coneRootNodeId,
    focusedRootNodeIds: normalizeFocusedRootNodeIds(state.focusedRootNodeIds, state.coneRootNodeId),
    focusedRootRefs: cloneObjectRefs(state.focusedRootRefs),
    activeFocusedRootNodeId: state.activeFocusedRootNodeId,
    occurrenceContext: state.occurrenceContext ? {
      rootModuleName: state.occurrenceContext.rootModuleName || null,
      occurrencePath: [...(state.occurrenceContext.occurrencePath || [])]
    } : null,
    faninDepth: state.faninDepth,
    fanoutDepth: state.fanoutDepth,
    timingBadgeChoices: cloneRecord(state.timingBadgeChoices),
    timingBadgePositions: { ...state.timingBadgePositions }
  });
}

export function restoreModuleWorkspace(state, moduleName, restoreNavigation = (value) => Object.assign(state, value)) {
  const saved = state.moduleWorkspaces.get(moduleName);
  resetModuleWorkspace(state, restoreNavigation);
  if (!saved) return false;
  const roots = normalizeFocusedRootNodeIds(saved.focusedRootNodeIds, saved.coneRootNodeId);
  state.occurrenceContext = saved.occurrenceContext ? {
    rootModuleName: saved.occurrenceContext.rootModuleName || null,
    occurrencePath: [...(saved.occurrenceContext.occurrencePath || [])]
  } : null;
  restoreNavigation({ showPath: saved.showPath || null, nodePositions: new Map(saved.nodePositions), nodeSizes: new Map(saved.nodeSizes),
    graphOverrides: cloneGraphOverrides(saved.graphOverrides), viewMode: normalizeSingleViewMode(saved.viewMode),
    faninDepth: normalizeDepth(saved.faninDepth, state.faninDepth),
    fanoutDepth: normalizeDepth(saved.fanoutDepth, state.fanoutDepth),
    focusedRootNodeIds: roots, focusedRootRefs: cloneObjectRefs(saved.focusedRootRefs),
    coneRootNodeId: roots[0] || null,
    activeFocusedRootNodeId: roots.includes(saved.activeFocusedRootNodeId) ? saved.activeFocusedRootNodeId : roots[0] || null,
    selectedNodeId: null, selectedNet: null });
  state.timingBadgeChoices = cloneRecord(saved.timingBadgeChoices);
  state.timingBadgePositions = { ...saved.timingBadgePositions };
  return true;
}

export function saveCompareWorkspace(state) {
  const key = compareWorkspaceKey(state.compare.leftModuleName, state.compare.rightModuleName);
  if (!key) return;
  state.compareWorkspaces.set(key, cloneCompareAdjustments(state.compare));
}

export function restoreCompareWorkspace(state, leftModuleName, rightModuleName, restoreNavigation = (value) => {
  Object.assign(state.compare, value);
}) {
  const saved = state.compareWorkspaces.get(compareWorkspaceKey(leftModuleName, rightModuleName));
  const fresh = saved || createCompareState();
  state.compare.outputName = fresh.outputName || null;
  state.compare.wholeRequested = fresh.wholeRequested === true;
  state.compare.timingBadgeChoices = {
    left: cloneRecord(fresh.timingBadgeChoices.left),
    right: cloneRecord(fresh.timingBadgeChoices.right)
  };
  state.compare.timingBadgePositions = {
    left: { ...fresh.timingBadgePositions.left },
    right: { ...fresh.timingBadgePositions.right }
  };
  restoreNavigation({
    showPath: fresh.showPath,
    transforms: {
      left: { ...fresh.transforms.left },
      right: { ...fresh.transforms.right }
    },
    nodePositions: cloneSideMaps(fresh.nodePositions),
    nodeSizes: cloneSideMaps(fresh.nodeSizes),
    graphOverrides: {
      left: cloneGraphOverrides(fresh.graphOverrides.left),
      right: cloneGraphOverrides(fresh.graphOverrides.right)
    },
    focusedRootNodeIds: { left: normalizeFocusedRootNodeIds(fresh.focusedRootNodeIds?.left), right: normalizeFocusedRootNodeIds(fresh.focusedRootNodeIds?.right) },
    focusedRootRefs: { left: cloneObjectRefs(fresh.focusedRootRefs?.left), right: cloneObjectRefs(fresh.focusedRootRefs?.right) },
    activeFocusedRootNodeId: { left: fresh.activeFocusedRootNodeId?.left || fresh.focusedRootNodeIds?.left?.[0] || null,
      right: fresh.activeFocusedRootNodeId?.right || fresh.focusedRootNodeIds?.right?.[0] || null }
  });
  state.compare.focusedRootsSynchronized = fresh.focusedRootsSynchronized !== false;
  return Boolean(saved);
}

export function resetModuleWorkspace(state, restoreNavigation = (value) => Object.assign(state, value)) {
  state.expandedGroupIds = new Set();
  restoreNavigation({ nodePositions: new Map(), nodeSizes: new Map(), graphOverrides: createEmptyGraphOverrides(),
    showPath: null, viewMode: "whole", coneRootNodeId: null, focusedRootNodeIds: [], focusedRootRefs: [], activeFocusedRootNodeId: null,
    selectedNodeId: null, selectedNet: null });
  state.occurrenceContext = null;
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
    showPath: { ...compare.showPath },
    outputName: compare.outputName || null,
    wholeRequested: compare.wholeRequested === true,
    transforms: {
      left: { ...compare.transforms.left },
      right: { ...compare.transforms.right }
    },
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
    focusedRootRefs: {
      left: cloneObjectRefs(compare.focusedRootRefs?.left),
      right: cloneObjectRefs(compare.focusedRootRefs?.right)
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
