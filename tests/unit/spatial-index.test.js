import assert from "node:assert/strict";
import test from "node:test";
import { countRouteConflicts } from "../../src/layout/orthogonalRouting.js";
import {
  computeNodeCollectionBox,
  createNodeSpatialIndex,
  RouteSegmentIndex,
  SpatialHashIndex
} from "../../src/layout/spatialIndex.js";

test("node collection bounds are computed once for corridor queries", () => {
  const nodes = [
    { x: 20, y: 30, width: 40, height: 50 },
    { x: 100, y: 10, width: 20, height: 30 }
  ];

  assert.deepEqual(computeNodeCollectionBox(nodes, 8), {
    left: 12,
    right: 128,
    top: 2,
    bottom: 88
  });
  assert.deepEqual(computeNodeCollectionBox([], 8), {
    left: 0, right: 0, top: 0, bottom: 0
  });
});

test("spatial hash returns only nearby items across positive and negative cells", () => {
  const index = new SpatialHashIndex(64);
  const left = { id: "left" };
  const right = { id: "right" };
  index.insert(left, { left: -140, right: -100, top: -20, bottom: 20 });
  index.insert(right, { left: 500, right: 540, top: 500, bottom: 540 });

  assert.deepEqual(
    index.query({ left: -120, right: -110, top: 0, bottom: 8 }),
    [left]
  );
  assert.deepEqual(index.query({ left: 0, right: 20, top: 0, bottom: 20 }), []);
});

test("node index bounds candidate counts on large sparse layouts", () => {
  const nodes = Array.from({ length: 3000 }, (_, index) => ({
    id: `n${index}`,
    x: (index % 100) * 240,
    y: Math.floor(index / 100) * 120,
    width: 100,
    height: 60
  }));
  const index = createNodeSpatialIndex(nodes);
  const nearby = index.query({ left: 1000, right: 1100, top: 1000, bottom: 1060 });

  assert.ok(nearby.length < 10);
  assert.ok(nearby.length > 0);
});

test("indexed route conflicts match array scanning after dynamic insertions", () => {
  const segments = [
    { start: { x: 100, y: 0 }, end: { x: 100, y: 200 }, net: "vertical" },
    { start: { x: 20, y: 80 }, end: { x: 180, y: 80 }, net: "horizontal" }
  ];
  const index = new RouteSegmentIndex();
  index.push(...segments);
  const candidate = [{ x: 0, y: 80 }, { x: 200, y: 80 }];

  assert.equal(
    countRouteConflicts(candidate, index, "candidate"),
    countRouteConflicts(candidate, segments, "candidate")
  );
  assert.equal(index.length, 2);
});
