import assert from "node:assert/strict";
import test from "node:test";
import {
  applyNodePositionOverrides,
  applyNodeSizeOverride,
  normalizeNodeOverrides
} from "../../src/layout/nodeOverrides.js";

test("node position overrides accept map, array and object inputs", () => {
  for (const overrides of [
    new Map([["u0", { x: "12", y: 24 }]]),
    [{ id: "u0", x: "12", y: 24 }],
    { u0: { x: "12", y: 24 } }
  ]) {
    const nodes = [{ id: "u0", x: 0, y: 0 }, { id: "u1", x: 8, y: 9 }];
    applyNodePositionOverrides(nodes, overrides);
    assert.deepEqual(nodes, [
      { id: "u0", x: 12, y: 24 },
      { id: "u1", x: 8, y: 9 }
    ]);
  }
});

test("node overrides ignore invalid coordinates and clamp valid sizes", () => {
  const nodes = [{ id: "u0", x: 5, y: 6 }];
  applyNodePositionOverrides(nodes, { u0: { x: "invalid", y: 18 } });
  assert.deepEqual(nodes[0], { id: "u0", x: 5, y: 18 });

  assert.deepEqual(
    applyNodeSizeOverride(
      { width: 80, height: 40 },
      { u0: { width: 8, height: 900 } },
      "u0"
    ),
    { width: 24, height: 260 }
  );
  assert.deepEqual(
    applyNodeSizeOverride(
      { width: 80, height: 40 },
      { u0: { width: "invalid", height: 60 } },
      "u0"
    ),
    { width: 80, height: 60 }
  );
});

test("node override normalization produces a stable keyed map", () => {
  const map = new Map([["u0", { x: 1 }]]);
  assert.equal(normalizeNodeOverrides(map), map);
  assert.deepEqual(
    [...normalizeNodeOverrides([{ id: "u0", x: 1 }, null, { x: 2 }])],
    [["u0", { id: "u0", x: 1 }]]
  );
  assert.deepEqual(
    [...normalizeNodeOverrides({ u1: { width: 40 } })],
    [["u1", { width: 40 }]]
  );
  assert.equal(normalizeNodeOverrides(null).size, 0);
});
