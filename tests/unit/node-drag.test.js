import assert from "node:assert/strict";
import test from "node:test";
import {
  getDraggedNodePosition,
  sameNodePosition
} from "../../src/ui/nodeDrag.js";

test("node drag applies pointer delta in content coordinates", () => {
  assert.deepEqual(
    getDraggedNodePosition(
      { x: 100, y: 80 },
      { x: 20, y: 30 },
      { x: 55.12345, y: 50.98765 }
    ),
    { x: 135.123, y: 100.988 }
  );
});

test("node drag clamps to the canvas margin and compares stable positions", () => {
  const position = getDraggedNodePosition(
    { x: 20, y: 20 },
    { x: 100, y: 100 },
    { x: 0, y: 0 }
  );
  assert.deepEqual(position, { x: 16, y: 16 });
  assert.equal(sameNodePosition(position, { x: 16, y: 16 }), true);
  assert.equal(sameNodePosition(position, { x: 16, y: 17 }), false);
  assert.equal(sameNodePosition(null, position), false);
});
