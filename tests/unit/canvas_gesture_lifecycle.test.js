import assert from "node:assert/strict";
import test from "node:test";
import { registerCanvasGesture, cancelCanvasGestures } from "../../src/ui/canvas_gesture_lifecycle.js";

test("replacement cancels only live gestures on the containing canvas", () => {
  const canvas = {}, other = {}, calls = [];
  const release = registerCanvasGesture(canvas, () => calls.push("completed"));
  release(); release();
  registerCanvasGesture(canvas, () => calls.push("pan"));
  registerCanvasGesture(canvas, () => calls.push("wheel"));
  registerCanvasGesture(other, () => calls.push("other"));
  cancelCanvasGestures({ closest: () => canvas }); cancelCanvasGestures(canvas);
  assert.deepEqual(calls, ["pan", "wheel"]);
  cancelCanvasGestures(other);
  assert.deepEqual(calls, ["pan", "wheel", "other"]);
});

test("one failed cleanup cannot strand another gesture or erase a new owner", () => {
  const canvas = {}, calls = [];
  let releaseOld;
  releaseOld = registerCanvasGesture(canvas, () => {
    registerCanvasGesture(canvas, () => calls.push("new"));
    releaseOld();
    throw new Error("old callback failed");
  });
  registerCanvasGesture(canvas, () => calls.push("second"));
  assert.throws(() => cancelCanvasGestures(canvas), AggregateError);
  assert.deepEqual(calls, ["second"]);
  cancelCanvasGestures(canvas);
  assert.deepEqual(calls, ["second", "new"]);
});
