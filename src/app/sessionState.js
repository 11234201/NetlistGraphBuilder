export const SESSION_STATE_KEY = "netlistGraphBuilder.session.v1";

export function loadSessionState(storage = globalThis.sessionStorage) {
  try {
    const value = JSON.parse(storage?.getItem(SESSION_STATE_KEY) || "null");
    return value && value.version === 1 ? value : null;
  } catch {
    return null;
  }
}

export function saveSessionState(snapshot, storage = globalThis.sessionStorage) {
  try {
    storage?.setItem(SESSION_STATE_KEY, JSON.stringify({ version: 1, ...snapshot }));
    return true;
  } catch {
    return false;
  }
}

export function createSessionSnapshot(state) {
  return {
    source: state.currentSource,
    sourceLabel: state.currentSourceLabel,
    moduleName: state.currentModule?.name || null,
    viewMode: state.viewMode,
    coneRootNodeId: state.coneRootNodeId,
    coneDepth: state.coneDepth,
    searchQuery: state.searchQuery,
    showAliases: state.showAliases,
    layoutProviderId: state.layoutProviderId,
    transform: { ...state.transform },
    useFanoutHubs: state.useFanoutHubs,
    collapseLargeGroups: state.collapseLargeGroups
  };
}
