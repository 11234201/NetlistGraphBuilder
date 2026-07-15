import assert from "node:assert/strict";
import test from "node:test";
import { collectRerouteEdgeIds } from "../../src/layout/rerouteInvalidation.js";

test("reroute invalidation includes connected and newly blocked edges", () => {
  const edges = [
    {
      id: "connected",
      source: "moving",
      target: "target",
      net: "connected",
      points: [{ x: 0, y: 20 }, { x: 400, y: 20 }]
    },
    {
      id: "blocked",
      source: "left",
      target: "right",
      net: "blocked",
      points: [{ x: 0, y: 100 }, { x: 400, y: 100 }]
    },
    {
      id: "far",
      source: "far-left",
      target: "far-right",
      net: "far",
      points: [{ x: 0, y: 300 }, { x: 400, y: 300 }]
    }
  ];
  const moving = { id: "moving", x: 180, y: 80, width: 80, height: 40 };

  assert.deepEqual(
    [...collectRerouteEdgeIds(edges, [moving])].toSorted(),
    ["blocked", "connected"]
  );
});

test("reroute invalidation handles edges without existing route points", () => {
  const edges = [{ id: "new", source: "a", target: "b", net: "new" }];

  assert.deepEqual(
    [...collectRerouteEdgeIds(edges, [], new Set(["a"]))],
    ["new"]
  );
});

test("reroute invalidation indexes large sparse route sets", () => {
  const edges = Array.from({ length: 5000 }, (_, index) => ({
    id: `e${index}`,
    source: `s${index}`,
    target: `t${index}`,
    net: `n${index}`,
    points: [{ x: 0, y: index * 20 }, { x: 400, y: index * 20 }]
  }));
  const blocker = { id: "blocker", x: 180, y: 40000, width: 80, height: 40 };

  const invalidated = collectRerouteEdgeIds(edges, [blocker]);

  assert.ok(invalidated.size <= 4);
  assert.ok(invalidated.has("e2000"));
});
