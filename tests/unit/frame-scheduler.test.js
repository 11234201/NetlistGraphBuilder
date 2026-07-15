import assert from "node:assert/strict";
import test from "node:test";
import { createLatestFrameScheduler } from "../../src/ui/frameScheduler.js";

test("frame scheduler coalesces work to the latest value", () => {
  const frames = new FakeFrames();
  const values = [];
  const scheduler = createLatestFrameScheduler((value) => values.push(value), frames.options());

  scheduler.schedule(1);
  scheduler.schedule(2);
  scheduler.schedule(3);

  assert.equal(frames.pendingCount(), 1);
  frames.runNext();
  assert.deepEqual(values, [3]);
  assert.equal(scheduler.pending, false);
});

test("frame scheduler flushes the final pointer value synchronously", () => {
  const frames = new FakeFrames();
  const values = [];
  const scheduler = createLatestFrameScheduler((value) => values.push(value), frames.options());

  scheduler.schedule({ x: 10 });
  scheduler.schedule({ x: 20 });
  scheduler.flush();
  frames.runNext();

  assert.deepEqual(values, [{ x: 20 }]);
  assert.equal(frames.pendingCount(), 0);
});

class FakeFrames {
  constructor() {
    this.nextId = 1;
    this.callbacks = new Map();
  }

  options() {
    return {
      requestFrame: (callback) => {
        const id = this.nextId++;
        this.callbacks.set(id, callback);
        return id;
      },
      cancelFrame: (id) => this.callbacks.delete(id)
    };
  }

  runNext() {
    const entry = this.callbacks.entries().next().value;
    if (!entry) return;
    this.callbacks.delete(entry[0]);
    entry[1]();
  }

  pendingCount() {
    return this.callbacks.size;
  }
}
