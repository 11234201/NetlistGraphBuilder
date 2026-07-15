import assert from "node:assert/strict";
import test from "node:test";
import {
  countRouteConflicts,
  getTargetApproachPoint,
  routeFollowsEndpointSides,
  routePreservesEndpointAccess
} from "../../src/layout/orthogonalRouting.js";
import { validateLayoutGraph } from "../../src/layout/layoutValidator.js";

const source = { id: "source", x: 0, y: 40, width: 80, height: 28 };
const target = { id: "target", x: 200, y: 100, width: 120, height: 72 };

test("top and bottom target pins require a vertical final segment", () => {
  const topPin = { x: 260, y: 100 };
  const bottomPin = { x: 260, y: 172 };

  assert.equal(routeFollowsEndpointSides([
    { x: 80, y: 54 }, { x: 260, y: 91 }, topPin
  ], source, target), true);
  assert.equal(routeFollowsEndpointSides([
    { x: 80, y: 54 }, { x: 230, y: 100 }, topPin
  ], source, target), false);
  assert.equal(routeFollowsEndpointSides([
    { x: 80, y: 54 }, { x: 260, y: 181 }, bottomPin
  ], source, target), true);
});

test("target approach points encode the declared boundary side", () => {
  assert.deepEqual(
    getTargetApproachPoint(target, { x: 260, y: 100 }, 9),
    { x: 260, y: 91 }
  );
  assert.deepEqual(
    getTargetApproachPoint(target, { x: 200, y: 136 }, 9),
    { x: 200, y: 136 }
  );
});

test("endpoint access rejects routes that re-enter either endpoint body", () => {
  assert.equal(routePreservesEndpointAccess([
    { x: 80, y: 54 },
    { x: 40, y: 54 },
    { x: 40, y: 136 },
    { x: 200, y: 136 }
  ], source, target), false);
  assert.equal(routePreservesEndpointAccess([
    { x: 80, y: 54 },
    { x: 120, y: 54 },
    { x: 120, y: 136 },
    { x: 200, y: 136 }
  ], source, target), true);
});

test("shared conflict counting treats crossings and overlaps consistently", () => {
  const reserved = [
    { start: { x: 100, y: 20 }, end: { x: 100, y: 80 }, net: "other" },
    { start: { x: 120, y: 54 }, end: { x: 180, y: 54 }, net: "another" }
  ];
  assert.equal(countRouteConflicts([
    { x: 80, y: 54 }, { x: 200, y: 54 }
  ], reserved, "candidate"), 2);
  assert.equal(countRouteConflicts([
    { x: 80, y: 54 }, { x: 200, y: 54 }
  ], reserved, "another"), 1);
});

test("layout validation reports stable route invariant codes", () => {
  const mux = {
    ...target,
    kind: "cell",
    ports: [{ pin: "S", direction: "input", side: "top", x: 60, y: 0 }]
  };
  const base = {
    nodes: [source, mux],
    edges: [{
      id: "select",
      source: source.id,
      target: mux.id,
      targetPin: "S",
      net: "select",
      points: [
        { x: 80, y: 54 },
        { x: 120, y: 54 },
        { x: 120, y: 91 },
        { x: 260, y: 91 },
        { x: 260, y: 100 }
      ]
    }]
  };

  assert.deepEqual(validateLayoutGraph(base), []);
  const invalid = structuredClone(base);
  invalid.edges[0].points = [
    { x: 80, y: 54 },
    { x: 260, y: 100 }
  ];
  assert.deepEqual(
    validateLayoutGraph(invalid).map((item) => item.code).sort(),
    ["non-orthogonal", "wrong-port-side"]
  );
});
