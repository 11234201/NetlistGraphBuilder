import assert from "node:assert/strict";
import test from "node:test";
import { iterateLocalRouteCandidates } from "../../src/layout/localRouteCandidates.js";
import { createNodeSpatialIndex } from "../../src/layout/spatialIndex.js";

const source = { id: "source", x: 0, y: 40, width: 80, height: 28 };
const target = { id: "target", x: 200, y: 40, width: 100, height: 60 };

function candidates(overrides = {}) {
  const context = {
    source,
    target,
    start: { x: 80, y: 54 },
    end: { x: 200, y: 54 },
    nodes: [source, target],
    margin: 16,
    ...overrides
  };
  context.nodeIndex = createNodeSpatialIndex(context.nodes);
  return [...iterateLocalRouteCandidates(context)];
}

test("Adjust candidate policy yields a straight connection first", () => {
  const result = candidates();
  assert.deepEqual(result[0], {
    kind: "direct",
    points: [{ x: 80, y: 54 }, { x: 200, y: 54 }]
  });
  assert.ok(result.some((candidate) => candidate.kind === "local-detour"));
  assert.ok(result.some((candidate) => candidate.kind === "outer-lane"));
});

test("Adjust candidates preserve vertical approach to a top pin", () => {
  const mux = { ...target, y: 100, height: 80 };
  const result = candidates({
    target: mux,
    end: { x: 250, y: 100 },
    nodes: [source, mux]
  });

  assert.equal(result[0].kind, "channel");
  assert.equal(result[0].points.at(-2).x, 250);
  assert.ok(result[0].points.at(-2).y < 100);
});

test("reverse-direction connections start with a local detour", () => {
  const rightSource = { ...source, x: 360 };
  const result = candidates({
    source: rightSource,
    start: { x: 440, y: 54 },
    nodes: [rightSource, target]
  });

  assert.equal(result[0].kind, "local-detour");
  assert.deepEqual(result[0].points[0], { x: 440, y: 54 });
  assert.deepEqual(result[0].points.at(-1), { x: 200, y: 54 });
});
