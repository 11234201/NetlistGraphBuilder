import { normalizeFocusedRootNodeIds, setFocusedRootNodeIds } from "./appState.js";
import { normalizeSingleViewMode } from "./singleViewMode.js";

export function resolveLayoutGoldenModule(design, imported, currentIdentity = null) {
  validateGoldenIdentity(imported.identity, currentIdentity);
  const module = design?.modules?.find((item) => item.name === imported.moduleName);
  if (!module) {
    throw new Error(`module ${imported.moduleName} is not present; load its Verilog netlist first`);
  }
  return module;
}

function validateGoldenIdentity(goldenIdentity, currentIdentity) {
  if (!goldenIdentity || !currentIdentity) return;
  if (goldenIdentity.domainId && currentIdentity.domainId && goldenIdentity.domainId !== currentIdentity.domainId) {
    throw new Error("Golden belongs to another domain");
  }
  if (goldenIdentity.documentId && currentIdentity.documentId && goldenIdentity.documentId !== currentIdentity.documentId) {
    throw new Error("Golden belongs to another document");
  }
  const goldenSource = goldenIdentity.sourceIdentity;
  const currentSource = currentIdentity.sourceIdentity;
  if (goldenSource && currentSource && (
    goldenSource.name !== currentSource.name ||
    (goldenSource.size !== null && goldenSource.size !== currentSource.size)
  )) {
    throw new Error("Golden belongs to another source");
  }
}

export function applyLayoutGoldenState(state, imported) {
  state.nodePositions = new Map(imported.nodePositions);
  state.nodeSizes = new Map(imported.nodeSizes);
  state.graphOverrides = imported.graphOverrides;
  state.timingBadgeChoices = imported.timingBadgeChoices;
  state.timingBadgePositions = imported.timingBadgePositions;
  if (imported.layoutPolicy) state.layoutPolicy = imported.layoutPolicy;

  const display = imported.display;
  const viewMode = normalizeSingleViewMode(display.viewMode);
  if (viewMode === "whole") {
    state.viewMode = "whole";
    setFocusedRootNodeIds(state, []);
  } else if (display.viewMode && (display.focusedRootNodeIds?.length || display.coneRootNodeId)) {
    state.viewMode = viewMode;
    setFocusedRootNodeIds(state, normalizeFocusedRootNodeIds(
      display.focusedRootNodeIds,
      display.coneRootNodeId
    ), display.activeFocusedRootNodeId);
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
