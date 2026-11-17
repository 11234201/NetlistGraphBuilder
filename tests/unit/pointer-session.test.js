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
  assert.equal(target.releasedPointerId, 7);
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

test("lost capture cancels the owning pointer once and releases every listener", () => {
  const target = new FakeTarget();
  const ended = [];
  startPointerSession({ target, pointerId: 7, className: "active", onEnd: (event) => ended.push(event.type) });
  target.dispatch("lostpointercapture", { pointerId: 8 });
  assert.equal(target.classList.has("active"), true);
  target.dispatch("lostpointercapture", { pointerId: 7 });
  target.dispatch("pointerup", { pointerId: 7 });
  assert.deepEqual(ended, ["pointercancel"]);
  assert.equal(target.listenerCount(), 0);
  assert.equal(target.classList.has("active"), false);
});

test("failed final preview still releases capture and transient styling", () => {
  const target = new FakeTarget();
  startPointerSession({ target, pointerId: 7, className: "active",
    beforeEnd() { throw new Error("preview failed"); },
    onEnd() { assert.fail("failed preview must not be persisted"); }
  });
  assert.throws(() => target.dispatch("pointerup", { pointerId: 7 }), /preview failed/);
  assert.equal(target.listenerCount(), 0);
  assert.equal(target.hasPointerCapture(7), false);
  assert.equal(target.classList.size, 0);
});

class FakeTarget {
  constructor() {
    this.listeners = new Map();
    this.classList = new FakeClassList();
  }

  setPointerCapture(pointerId) {
    this.capturedPointerId = pointerId;
  }

  hasPointerCapture(pointerId) {
    return this.capturedPointerId === pointerId && this.releasedPointerId !== pointerId;
  }

  releasePointerCapture(pointerId) {
    this.releasedPointerId = pointerId;
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
