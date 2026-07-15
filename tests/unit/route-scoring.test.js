import assert from "node:assert/strict";
import test from "node:test";
import {
  compareRouteCandidates,
  scoreRouteCandidate
} from "../../src/layout/routeScoring.js";

test("route scoring prefers a local detour over crossing another net", () => {
  const reservedSegments = [{
    start: { x: 50, y: -10 },
    end: { x: 50, y: 10 },
    net: "reserved"
  }];
  const crossing = { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
  const detour = {
    points: [
      { x: 0, y: 0 },
      { x: 0, y: 20 },
      { x: 100, y: 20 },
      { x: 100, y: 0 }
    ]
  };
  const context = { reservedSegments, net: "candidate", edgeIntent: { fanout: 1 } };

  assert.ok(compareRouteCandidates(detour, crossing, context) < 0);
  assert.equal(scoreRouteCandidate(crossing, context).crossings, 1);
});

test("secondary fanout branches use the declared lower bend cost", () => {
  const candidate = {
    points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 40 }]
  };
  const primary = scoreRouteCandidate(candidate, {
    edgeIntent: { fanout: 3, isPrimary: true }
  });
  const secondary = scoreRouteCandidate(candidate, {
    edgeIntent: { fanout: 3, isPrimary: false }
  });

  assert.equal(primary.bendCost, 120);
  assert.equal(secondary.bendCost, 40);
  assert.ok(primary.total > secondary.total);
});
