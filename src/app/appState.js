export function createAppState(layoutPolicy) {
  return {
    design: null,
    currentModule: null,
    autoGraph: null,
    graph: null,
    transform: { x: 0, y: 0, scale: 1 },
    selectedNodeId: null,
    nodePositions: new Map(),
    nodeSizes: new Map(),
    graphOverrides: createEmptyGraphOverrides(),
    timing: null,
    timingBadgeChoices: {},
    timingBadgePositions: {},
    calibrationMode: false,
    layoutPolicy: cloneLayoutPolicy(layoutPolicy)
  };
}

export function resetDesignWorkspace(state) {
  resetModuleWorkspace(state);
  state.selectedNodeId = null;
  state.timing = null;
}

export function resetModuleWorkspace(state) {
  state.nodePositions = new Map();
  state.nodeSizes = new Map();
  state.graphOverrides = createEmptyGraphOverrides();
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
