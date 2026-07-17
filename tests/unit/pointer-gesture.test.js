import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_POINTER_DRAG_THRESHOLD,
  hasPointerDragged
} from "../../src/ui/pointerGesture.js";

test("pointer movement below the drag threshold remains a click", () => {
  assert.equal(hasPointerDragged({ x: 10, y: 10 }, { x: 12, y: 11 }), false);
});

test("pointer movement at or beyond the drag threshold is a drag", () => {
  assert.equal(
    hasPointerDragged(
      { x: 10, y: 10 },
      { x: 10 + DEFAULT_POINTER_DRAG_THRESHOLD, y: 10 }
    ),
    true
  );
  assert.equal(hasPointerDragged({ x: 10, y: 10 }, { x: 30, y: 40 }), true);
});

test("invalid pointer coordinates do not start a drag", () => {
  assert.equal(hasPointerDragged({ x: 10, y: 10 }, { x: undefined, y: 20 }), false);
  assert.equal(hasPointerDragged(null, { x: 20, y: 20 }), false);
});
