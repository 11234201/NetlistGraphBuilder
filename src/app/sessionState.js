import { normalizeFocusedRootNodeIds as normalizePolicyRoots } from "./focusedViewPolicy.js";
export { SESSION_STATE_KEY, LEGACY_SESSION_STATE_KEY, loadSessionState, saveSessionState } from "../persistence/session_storage.js";
import { createSourceIdentity } from "../persistence/source_identity.js";
import { isObjectRef } from "../contracts/object_ref.js";
import { DEFAULT_LAYOUT_PROVIDER_ID } from "../layout/providerDefaults.js";
import { cloneNetRoutingOverrides } from "../domains/netlist/net_routing.js";

export function getSessionLayoutProviderId(session) {
  const providerId = session?.layoutProviderId;
  // Older snapshots cannot distinguish a persisted failure fallback from a choice.
  if (!session?.layoutProviderPreferenceVersion && providerId === "simple-layered") {
    return DEFAULT_LAYOUT_PROVIDER_ID;
  }
  return ["native-layered", "elk-layered", "simple-layered"].includes(providerId)
    ? providerId : DEFAULT_LAYOUT_PROVIDER_ID;
}

export function createSessionSnapshot(state) {
  const focusedRootNodeIds = normalizeFocusedRootNodeIds(
    state.focusedRootNodeIds,
    state.coneRootNodeId
  );
  return {
    domainId: state.document?.domainId || "netlist",
    documentId: state.document?.documentId || null,
    unitId: state.currentModule?.name || null,
    sourceIdentity: state.sourceIdentity || createSourceIdentity(
      state.currentSourceLabel || state.document?.source?.name,
      state.currentSource
    ),
    source: state.currentSource,
    sourceLabel: state.currentSourceLabel,
    moduleName: state.currentModule?.name || null,
    viewMode: state.viewMode,
    coneRootNodeId: state.coneRootNodeId,
    focusedRootNodeIds,
    focusedRootRefs: normalizeFocusedRootRefs(state.focusedRootRefs),
    activeFocusedRootNodeId: focusedRootNodeIds.includes(state.activeFocusedRootNodeId)
      ? state.activeFocusedRootNodeId
      : focusedRootNodeIds[0] || null,
    coneDepth: state.coneDepth,
    faninDepth: state.faninDepth,
    fanoutDepth: state.fanoutDepth,
    searchQuery: state.searchQuery,
    showAliases: state.showAliases,
    ...cloneNetRoutingOverrides(state.graphOverrides),
    layoutProviderId: state.layoutFallbackFromProviderId || state.layoutProviderId,
    layoutProviderPreferenceVersion: 1,
    transform: { ...state.transform },
    useFanoutHubs: state.useFanoutHubs,
    // Retain the legacy codec field as an explicit disabled value.
    collapseLargeGroups: false,
    layoutPolicy: {
      name: state.layoutPolicy?.name,
      spacing: { ...(state.layoutPolicy?.spacing || {}) },
      features: { ...(state.layoutPolicy?.features || {}) }
    },
    presentationPolicy: { ...(state.presentationPolicy || {}) },
    timingDisplayPolicy: {
      metrics: [...(state.timingDisplayPolicy?.metrics || ["slack"])],
      threshold: Number.isFinite(Number(state.timingDisplayPolicy?.threshold))
        ? Number(state.timingDisplayPolicy.threshold)
        : 0.0
    }
  };
}

function normalizeFocusedRootNodeIds(value, legacyRootNodeId = null) {
  return normalizePolicyRoots(value, legacyRootNodeId);
}

function normalizeFocusedRootRefs(value) {
  return (Array.isArray(value) ? value : [])
    .filter((ref) => isObjectRef(ref))
    .map((ref) => ({
      ...ref,
      ...(Array.isArray(ref.occurrencePath) ? { occurrencePath: [...ref.occurrencePath] } : {})
    }));
}
