export const ROUTE_SEARCH_LIMITS = Object.freeze({
  localChannelAlternatives: 8,
  expandedLocalChannelAlternatives: 64,
  maximumExpandedLocalCandidateAttempts: 512,
  // Eight symmetric samples plus prepared internal gap lanes cover the
  // bounded outer-corridor contract. Keeping this fixed and small matters on
  // dense mapped cases where thousands of edges otherwise repeat the same
  // obstacle checks.
  minimumOuterLaneAttempts: 8,
  maximumOuterLaneAttempts: 32,
  maximumGlobalLaneCandidates: 512,
  // Jointly select carrier variants for a small set of competing physical
  // nets. This prevents lexical greedy order from sacrificing an entire
  // clock/reset tree while keeping the search independent of graph size.
  maximumCarrierCombinationGroups: 8,
  maximumCarrierCombinationStates: 1024,
  // Carrier tracks are allocated inside an already bounded inter-layer gap.
  // Keep this aligned with the capacity planner's per-scope lane ceiling so
  // route generation can consume reserved space without graph-sized search.
  maximumBoundaryCarrierTracks: 256
});

export const ROUTE_SELECTION_POLICY = Object.freeze({
  minimumOuterDetourSavings: 96,
  outerDetourWirePitchMultiplier: 4,
  maximumAdditionalLocalCrossings: 6
});

export const ROUTE_GEOMETRY_POLICY = Object.freeze({
  // Keep the target approach outside the node padding; the horizontal corner
  // has its own minimum visibility rule below.
  targetApproachClearance: 9,
  minimumVisibleTargetCornerGap: 16,
  maximumEndpointInset: 24,
  minimumEndpointInset: 2,
  reverseEndpointInset: 12,
  boundaryCarrierTrackPitch: 8
});
