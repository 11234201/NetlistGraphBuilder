export function resolveLayoutGoldenModule(design, imported) {
  const module = design?.modules?.find((item) => item.name === imported.moduleName);
  if (!module) {
    throw new Error(`module ${imported.moduleName} is not present; load its Verilog netlist first`);
  }
  return module;
}

export function applyLayoutGoldenState(state, imported) {
  state.nodePositions = new Map(imported.nodePositions);
  state.nodeSizes = new Map(imported.nodeSizes);
  state.graphOverrides = imported.graphOverrides;
  state.timingBadgeChoices = imported.timingBadgeChoices;
  state.timingBadgePositions = imported.timingBadgePositions;
  if (imported.layoutPolicy) state.layoutPolicy = imported.layoutPolicy;

  const display = imported.display;
  if (display.viewMode === "whole") {
    state.viewMode = "whole";
    state.coneRootNodeId = null;
  } else if (display.viewMode && display.coneRootNodeId) {
    state.viewMode = display.viewMode;
    state.coneRootNodeId = display.coneRootNodeId;
  }
  if (display.coneDepth) state.coneDepth = clamp(display.coneDepth, 1, 99);
  if (display.useFanoutHubs !== null) state.useFanoutHubs = display.useFanoutHubs;
  if (display.collapseLargeGroups !== null) {
    state.collapseLargeGroups = display.collapseLargeGroups;
  }
  if (display.expandedGroupIds) state.expandedGroupIds = new Set(display.expandedGroupIds);
  return state;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
