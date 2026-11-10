import { createWorkspaceArtifactKey, workspaceArtifactReference } from "./workspaceArtifactCache.js";

export function createSingleWorkspaceIdentity(state, cellLibrary = null) {
  return createWorkspaceArtifactKey({
    document: [state.document?.documentId || null, state.document?.sourceRevision || 0],
    module: state.currentModule?.name || null,
    occurrence: state.occurrenceContext || null,
    viewMode: state.viewMode,
    roots: [state.focusedRootNodeIds || [], state.focusedRootRefs || [], state.activeFocusedRootNodeId || null],
    depths: [state.coneDepth, state.faninDepth, state.fanoutDepth],
    nodePositions: state.nodePositions,
    nodeSizes: state.nodeSizes,
    graphOverrides: state.graphOverrides,
    showAliases: state.showAliases,
    useFanoutHubs: state.useFanoutHubs,
    layout: [state.layoutProviderId, state.layoutPolicy],
    timing: [state.timing, state.timingDisplayPolicy, state.timingBadgeChoices, state.timingBadgePositions],
    cellLibrary: workspaceArtifactReference(cellLibrary),
    cellConfig: state.cellConfig
  });
}

export function createCompareWorkspaceIdentity(state, cellLibrary = null) {
  return createWorkspaceArtifactKey({
    document: [state.document?.documentId || null, state.document?.sourceRevision || 0],
    modules: [state.compare.leftModuleName, state.compare.rightModuleName],
    output: [state.compare.outputName, state.compare.wholeRequested],
    roots: [state.compare.focusedRootNodeIds, state.compare.focusedRootRefs, state.compare.activeFocusedRootNodeId],
    depths: [state.coneDepth, state.faninDepth, state.fanoutDepth],
    nodePositions: state.compare.nodePositions,
    nodeSizes: state.compare.nodeSizes,
    graphOverrides: state.compare.graphOverrides,
    showAliases: state.showAliases,
    useFanoutHubs: state.useFanoutHubs,
    layout: [state.layoutProviderId, state.layoutPolicy],
    timing: [state.timing, state.timingDisplayPolicy, state.compare.timingBadgeChoices, state.compare.timingBadgePositions],
    cellLibrary: workspaceArtifactReference(cellLibrary),
    cellConfig: state.cellConfig
  });
}
