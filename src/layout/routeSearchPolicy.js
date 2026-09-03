export const ROUTE_SEARCH_LIMITS = Object.freeze({
  localChannelAlternatives: 8,
  expandedLocalChannelAlternatives: 64,
  maximumExpandedLocalCandidateAttempts: 512,
  minimumOuterLaneAttempts: 32,
  maximumOuterLaneAttempts: 256,
  maximumGlobalLaneCandidates: 512
});

export const ROUTE_SELECTION_POLICY = Object.freeze({
  minimumOuterDetourSavings: 96,
  outerDetourWirePitchMultiplier: 4,
  maximumAdditionalLocalCrossings: 6
});
