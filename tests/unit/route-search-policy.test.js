import assert from "node:assert/strict";
import test from "node:test";
import { ROUTE_SEARCH_LIMITS } from "../../src/layout/routeSearchPolicy.js";
import { MAX_GLOBAL_LANE_CANDIDATES } from "../../src/layout/simpleRouteCandidates.js";

test("Simple and Adjust share bounded route search limits", () => {
  assert.equal(MAX_GLOBAL_LANE_CANDIDATES, ROUTE_SEARCH_LIMITS.maximumGlobalLaneCandidates);
  assert.ok(ROUTE_SEARCH_LIMITS.maximumOuterLaneAttempts < 1000);
  assert.ok(
    ROUTE_SEARCH_LIMITS.minimumOuterLaneAttempts <
    ROUTE_SEARCH_LIMITS.maximumOuterLaneAttempts
  );
  assert.equal(Object.isFrozen(ROUTE_SEARCH_LIMITS), true);
});
