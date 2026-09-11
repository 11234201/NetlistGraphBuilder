import assert from "node:assert/strict";
import test from "node:test";
import { startCanvasPan } from "../../src/ui/canvas_pan_controller.js";

function pointerTarget() {
  const listeners = {};
  return {
    listeners,
    classList: { add() {}, remove() {} },
    addEventListener: (type, handler) => { listeners[type] = handler; },
    removeEventListener: (type) => { delete listeners[type]; },
    setPointerCapture() {}, hasPointerCapture: () => true, releasePointerCapture() {}
  };
}

test("shared canvas pan commits frame-coalesced transforms and reports click versus cancel", () => {
  const target = pointerTarget();
  const commits = [];
  const endings = [];
  const svg = {
    viewBox: { baseVal: { x: 0, y: 0, width: 200, height: 100 } },
    getBoundingClientRect: () => ({ width: 200, height: 100 })
  };
  assert.equal(startCanvasPan({
    event: { clientX: 10, clientY: 10, pointerId: 1 }, target, svg,
    transform: { x: 0, y: 0, scale: 1 },
    commit: (value) => commits.push(value),
    onEnd: (value) => endings.push(value)
  }), true);
  target.listeners.pointermove({ clientX: 30, clientY: 20 });
  target.listeners.pointerup({ type: "pointerup" });
  assert.deepEqual(commits.at(-1), { x: 20, y: 10, scale: 1 });
  assert.deepEqual(endings, [{ didPan: true, cancelled: false }]);
});

test("canvas pan rejects missing surfaces", () => {
  assert.equal(startCanvasPan({}), false);
});
