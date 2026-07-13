export function createAppState(layoutPolicy) {
  return {
    design: null,
    currentSource: null,
    currentSourceLabel: null,
    currentModule: null,
    fullGraph: null,
    autoGraph: null,
    graph: null,
    transform: { x: 0, y: 0, scale: 1 },
    selectedNodeId: null,
    selectedNet: null,
    viewMode: "whole",
    coneRootNodeId: null,
    coneDepth: 3,
    showAliases: false,
    useFanoutHubs: true,
    collapseLargeGroups: true,
    expandedGroupIds: new Set(),
    searchIndex: [],
    searchQuery: "",
    searchResults: [],
    activeSearchResult: -1,
    nodePositions: new Map(),
    nodeSizes: new Map(),
    graphOverrides: createEmptyGraphOverrides(),
    timing: null,
    timingBadgeChoices: {},
    timingBadgePositions: {},
    calibrationMode: false,
    layoutProviderId: "simple-layered",
    layoutRequestId: 0,
    layoutPolicy: cloneLayoutPolicy(layoutPolicy),
    moduleWorkspaces: new Map(),
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
    fullGraphs: { left: null, right: null },
    transforms: {
      left: { x: 0, y: 0, scale: 1 },
      right: { x: 0, y: 0, scale: 1 }
    },
    synchronized: true,
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
    analysis: null
  };
}

export function resetDesignWorkspace(state) {
  resetModuleWorkspace(state);
  state.selectedNodeId = null;
  state.selectedNet = null;
  state.searchResults = [];
  state.activeSearchResult = -1;
  state.timing = null;
  state.moduleWorkspaces = new Map();
  state.compareWorkspaces = new Map();
}

export function saveModuleWorkspace(state, moduleName) {
  if (!moduleName) return;
  state.moduleWorkspaces.set(moduleName, {
    nodePositions: new Map(state.nodePositions),
    nodeSizes: new Map(state.nodeSizes),
    graphOverrides: cloneGraphOverrides(state.graphOverrides),
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
  return Boolean(saved);
}

export function resetModuleWorkspace(state) {
  state.nodePositions = new Map();
  state.nodeSizes = new Map();
  state.graphOverrides = createEmptyGraphOverrides();
  state.expandedGroupIds = new Set();
  state.viewMode = "whole";
  state.coneRootNodeId = null;
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
    }
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
