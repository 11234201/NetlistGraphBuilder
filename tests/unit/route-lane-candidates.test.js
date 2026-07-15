import assert from "node:assert/strict";
import test from "node:test";
import {
  collectLocalLaneYs,
  queryReservedSegments
} from "../../src/layout/routeLaneCandidates.js";
import { RouteSegmentIndex } from "../../src/layout/spatialIndex.js";

test("local lane collection is stable across obstacle order", () => {
  const nodes = [
    { id: "lower", y: 80, height: 20 },
    { id: "upper", y: 10, height: 20 }
  ];
  const context = { sourceY: 50, targetY: 60, nodes, padding: 8 };

  assert.deepEqual(
    collectLocalLaneYs({ ...context, nodes: nodes.toReversed() }),
    collectLocalLaneYs(context)
  );
});

test("reserved segment queries use the shared index and ignore the current net", () => {
  const index = new RouteSegmentIndex([
    { start: { x: 20, y: 0 }, end: { x: 20, y: 100 }, net: "other" },
    { start: { x: 30, y: 0 }, end: { x: 30, y: 100 }, net: "current" },
    { start: { x: 300, y: 0 }, end: { x: 300, y: 100 }, net: "far" }
  ]);

  assert.deepEqual(queryReservedSegments(index, {
    left: 0, right: 100, top: 0, bottom: 100
  }, "current").map((segment) => segment.net), ["other"]);
});
