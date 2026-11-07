import { setFocusedRootNodeIds, normalizeFocusedRootNodeIds } from "./appState.js";
import { getSessionLayoutProviderId } from "./sessionState.js";
import { normalizeNetlistPresentationPolicy } from "../domains/netlist/netlist_presentation_policy.js";

// Legacy workbench adapter. State and elements are restricted ports supplied
// by the composition root; peer actions are explicit, late-bound services.
export function createPreferencesController({ state, elements, services }) {
  function applySessionPreferences(session) {
    if (session) {
      state.coneDepth = services.clamp(Number(session.coneDepth) || 3, 1, 99);
      state.faninDepth = services.clamp(Number.isFinite(Number(session.faninDepth)) ? Number(session.faninDepth) : 3, 0, 99);
      state.fanoutDepth = services.clamp(Number.isFinite(Number(session.fanoutDepth)) ? Number(session.fanoutDepth) : 3, 0, 99);
      setFocusedRootNodeIds(state, normalizeFocusedRootNodeIds(
        session.focusedRootNodeIds,
        session.coneRootNodeId
      ), session.activeFocusedRootNodeId);
      state.focusedRootRefs = services.cloneObjectRefs(session.focusedRootRefs);
      state.showAliases = Boolean(session.showAliases);
      state.layoutProviderId = getSessionLayoutProviderId(session);
      state.layoutFallbackFromProviderId = null;
      state.useFanoutHubs = session.useFanoutHubs !== false;
      // Group collapse is retired. Legacy sessions remain readable but cannot
      // reactivate the removed display transform.
      state.collapseLargeGroups = false;
      state.expandedGroupIds.clear();
      state.presentationPolicy = normalizeNetlistPresentationPolicy(session.presentationPolicy);
      if (session.layoutPolicy) services.setSingleLayoutPolicy(session.layoutPolicy);
      const snapshot = ["auto", "global", "local"].includes(session.timingDisplayPolicy?.snapshot)
        ? session.timingDisplayPolicy.snapshot : "auto";
      const metrics = session.timingDisplayPolicy?.metrics;
      state.timingDisplayPolicy = {
        snapshot,
        metrics: Array.isArray(metrics) && metrics.length ? metrics : ["slack"]
      };
    }
    elements.coneDepthInput.value = String(state.coneDepth);
    elements.faninDepthInput.value = String(state.faninDepth);
    elements.fanoutDepthInput.value = String(state.fanoutDepth);
    elements.gateSymbolModeSelect.value = state.presentationPolicy.gateSymbolMode;
    syncLayoutSpacingControls();
    services.timingDisplayController.sync();
  }

  function syncLayoutSpacingControls() {
    services.layoutSpacingController.sync();
  }

  return Object.freeze({ applySessionPreferences, syncLayoutSpacingControls });
}

export const preferencesPorts = Object.freeze({
  state: [
    "activeFocusedRootNodeId", "activeSearchResult", "autoGraph", "collapseLargeGroups", "compare",
    "compareWorkspaces", "coneDepth", "coneRootNodeId", "currentModule", "currentSource",
    "currentSourceLabel", "document", "expandedGroupIds", "faninDepth", "fanoutDepth",
    "focusedRootNodeIds", "focusedRootRefs", "fullGraph", "graph", "graphOverrides",
    "layoutFallbackFromProviderId", "layoutPolicy", "layoutProviderId", "moduleWorkspaces",
    "nodePositions", "nodeSizes", "occurrenceContext", "presentationPolicy", "restoringViewHistory",
    "scene", "searchQuery", "searchResults", "selectedNet", "selectedNodeId", "showAliases",
    "sourceIdentity", "timing", "timingBadgeChoices", "timingBadgePositions", "timingDisplayPolicy",
    "transform", "useFanoutHubs", "viewHistory", "viewMode", "workspaceArtifactCache"
  ],
  elements: [
    "coneDepthInput", "faninDepthInput", "fanoutDepthInput", "gateSymbolModeSelect"
  ],
  services: [
    "clamp", "cloneObjectRefs", "layoutSpacingController", "setSingleLayoutPolicy",
    "timingDisplayController"
  ]
});
