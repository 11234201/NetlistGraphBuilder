export function createAppState(layoutPolicy) {
  return {
    design: null,
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
    searchIndex: [],
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
    layoutPolicy: cloneLayoutPolicy(layoutPolicy),
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
}

export function resetModuleWorkspace(state) {
  state.nodePositions = new Map();
  state.nodeSizes = new Map();
  state.graphOverrides = createEmptyGraphOverrides();
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

function cloneLayoutPolicy(policy) {
  return {
    name: policy.name,
    spacing: { ...policy.spacing },
    features: { ...policy.features }
  };
}
