import assert from "node:assert/strict";
import test from "node:test";
import { startPointerSession } from "../../src/ui/pointerSession.js";

test("pointer session captures, dispatches and cleans up on pointer up", () => {
  const target = new FakeTarget();
  const classTarget = new FakeTarget();
  const moves = [];
  let ended = 0;

  startPointerSession({
    target,
    pointerId: 7,
    classTarget,
    className: "dragging",
    onMove: (event) => moves.push(event.x),
    onEnd: () => { ended += 1; }
  });
  target.dispatch("pointermove", { x: 10 });
  target.dispatch("pointerup", {});
  target.dispatch("pointermove", { x: 20 });
  target.dispatch("pointercancel", {});

  assert.equal(target.capturedPointerId, 7);
  assert.deepEqual(moves, [10]);
  assert.equal(ended, 1);
  assert.equal(classTarget.classList.has("dragging"), false);
});

test("pointer cancellation uses the same cleanup path", () => {
  const target = new FakeTarget();
  const finish = startPointerSession({ target, pointerId: 2, className: "active" });

  target.dispatch("pointercancel", {});
  finish({});

  assert.equal(target.listenerCount(), 0);
  assert.equal(target.classList.has("active"), false);
});

class FakeTarget {
  constructor() {
    this.listeners = new Map();
    this.classList = new FakeClassList();
  }

  setPointerCapture(pointerId) {
    this.capturedPointerId = pointerId;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type, event) {
    for (const listener of [...(this.listeners.get(type) || [])]) listener(event);
  }

  listenerCount() {
    return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0);
  }
}

class FakeClassList extends Set {
  remove(value) {
    this.delete(value);
  }
}
