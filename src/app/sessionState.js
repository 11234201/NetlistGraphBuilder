import { normalizeFocusedRootNodeIds as normalizePolicyRoots } from "./focusedViewPolicy.js";
import { decodeSessionSnapshot, encodeSessionSnapshot } from "../persistence/session_codec.js";
import { createSourceIdentity } from "../persistence/source_identity.js";
import { isObjectRef } from "../contracts/object_ref.js";

export const SESSION_STATE_KEY = "netlistGraphBuilder.session.v2";
export const LEGACY_SESSION_STATE_KEY = "netlistGraphBuilder.session.v1";

export function loadSessionState(storage = globalThis.sessionStorage) {
  try {
    const encoded = storage?.getItem(SESSION_STATE_KEY) || storage?.getItem(LEGACY_SESSION_STATE_KEY);
    return encoded ? decodeSessionSnapshot(encoded) : null;
  } catch {
    return null;
  }
}

export function saveSessionState(snapshot, storage = globalThis.sessionStorage) {
  try {
    storage?.setItem(SESSION_STATE_KEY, encodeSessionSnapshot(snapshot));
    return true;
  } catch {
    return false;
  }
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
    layoutProviderId: state.layoutProviderId,
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
      snapshot: state.timingDisplayPolicy?.snapshot || "auto",
      metrics: [...(state.timingDisplayPolicy?.metrics || ["slack"])]
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
