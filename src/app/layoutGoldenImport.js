import { normalizeFocusedRootNodeIds } from "./appState.js";
import { normalizeSingleViewMode } from "./singleViewMode.js";
import { sourceIdentitiesMatch } from "../persistence/source_identity.js";

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
  if (!sourceIdentitiesMatch(goldenSource, currentSource)) {
    throw new Error("Golden belongs to another source");
  }
}

export function applyLayoutGoldenState(state, imported, restoreNavigation = (value) => Object.assign(state, value)) {
  const viewState = { nodePositions: new Map(imported.nodePositions), nodeSizes: new Map(imported.nodeSizes),
    graphOverrides: imported.graphOverrides, ...(imported.layoutPolicy ? { layoutPolicy: imported.layoutPolicy } : {}) };
  state.timingBadgeChoices = imported.timingBadgeChoices;
  state.timingBadgePositions = imported.timingBadgePositions;


  const display = imported.display;
  const viewMode = normalizeSingleViewMode(display.viewMode);
  const query = {
    ...(display.coneDepth ? { coneDepth: clamp(display.coneDepth, 1, 99) } : {}),
    ...(display.faninDepth !== null ? { faninDepth: clamp(display.faninDepth, 0, 99) } : {}),
    ...(display.fanoutDepth !== null ? { fanoutDepth: clamp(display.fanoutDepth, 0, 99) } : {})
  };
  if (viewMode === "whole" || viewMode === "search-first") {
    restoreNavigation({ ...viewState, ...query, viewMode, focusedRootNodeIds: [], focusedRootRefs: [], activeFocusedRootNodeId: null, coneRootNodeId: null });
  } else if (display.viewMode) {
    const roots = normalizeFocusedRootNodeIds(display.focusedRootNodeIds, display.coneRootNodeId);
    restoreNavigation({ ...viewState, ...query, viewMode: roots.length > 0 ? viewMode : "whole",
      focusedRootNodeIds: roots, focusedRootRefs: cloneObjectRefs(display.focusedRootRefs),
      coneRootNodeId: roots[0] || null,
      activeFocusedRootNodeId: roots.includes(display.activeFocusedRootNodeId) ? display.activeFocusedRootNodeId : roots[0] || null });
  }
  if (!display.viewMode) restoreNavigation(viewState);
  if (display.useFanoutHubs !== null) state.useFanoutHubs = display.useFanoutHubs;
  // Decode legacy collapse fields for compatibility, but never reactivate the
  // retired display transform in a current workspace.
  state.collapseLargeGroups = false;
  state.expandedGroupIds = new Set();
  return state;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function cloneObjectRefs(value) {
  return (Array.isArray(value) ? value : []).map((ref) => ({
    ...ref,
    ...(Array.isArray(ref?.occurrencePath) ? { occurrencePath: [...ref.occurrencePath] } : {})
  }));
}
