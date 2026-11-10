// Compatibility projection from legacy UI state into a workspace request.
// Domain computation and scheduling belong to their owning boundaries.
export function createSingleWorkspaceInput(state, layoutProvider, cellLibrary = null) {
  return {
    module: state.currentModule,
    moduleLibrary: state.design.modules,
    graphOverrides: state.graphOverrides,
    cellConfig: state.cellConfig,
    cellLibrary,
    timing: state.timing,
    timingDisplayPolicy: state.timingDisplayPolicy,
    timingBadgeChoices: state.timingBadgeChoices,
    timingBadgePositions: state.timingBadgePositions,
    presentationPolicy: state.presentationPolicy,
    showAliases: state.showAliases,
    viewMode: state.viewMode,
    focusedRootNodeIds: state.focusedRootNodeIds,
    activeFocusedRootNodeId: state.activeFocusedRootNodeId,
    coneRootNodeId: state.coneRootNodeId,
    coneDepth: state.coneDepth,
    faninDepth: state.faninDepth,
    fanoutDepth: state.fanoutDepth,
    occurrencePath: state.occurrenceContext?.occurrencePath || null,
    useFanoutHubs: state.useFanoutHubs,
    layoutProvider,
    layoutPolicy: state.layoutPolicy,
    nodePositions: state.nodePositions,
    nodeSizes: state.nodeSizes,
    artifactCache: state.workspaceArtifactCache,
    artifactIdentity: {
      documentId: state.document?.documentId || null,
      sourceRevision: state.document?.sourceRevision || 0,
      sourceIdentity: state.sourceIdentity || null,
      sessionId: "single",
      unitId: state.currentModule?.name || null
    }
  };
}
