import assert from "node:assert/strict";
import test from "node:test";
import { ROUTE_SEARCH_LIMITS } from "../../src/layout/routeSearchPolicy.js";
import {
  MAX_EXPANDED_LOCAL_CANDIDATE_ATTEMPTS,
  MAX_EXPANDED_LOCAL_LANE_CANDIDATES,
  MAX_GLOBAL_LANE_CANDIDATES
} from "../../src/layout/simpleRouteCandidates.js";

test("Simple and Adjust share bounded route search limits", () => {
  assert.equal(MAX_GLOBAL_LANE_CANDIDATES, ROUTE_SEARCH_LIMITS.maximumGlobalLaneCandidates);
  assert.equal(
    MAX_EXPANDED_LOCAL_LANE_CANDIDATES,
    ROUTE_SEARCH_LIMITS.expandedLocalChannelAlternatives
  );
  assert.equal(
    MAX_EXPANDED_LOCAL_CANDIDATE_ATTEMPTS,
    ROUTE_SEARCH_LIMITS.maximumExpandedLocalCandidateAttempts
  );
  assert.ok(MAX_EXPANDED_LOCAL_CANDIDATE_ATTEMPTS <= MAX_GLOBAL_LANE_CANDIDATES);
  assert.ok(ROUTE_SEARCH_LIMITS.maximumOuterLaneAttempts < 1000);
  assert.ok(
    ROUTE_SEARCH_LIMITS.minimumOuterLaneAttempts <
    ROUTE_SEARCH_LIMITS.maximumOuterLaneAttempts
  );
  assert.equal(Object.isFrozen(ROUTE_SEARCH_LIMITS), true);
});
