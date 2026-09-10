import assert from "node:assert/strict";
import test from "node:test";
import { createWheelGestureController } from "../../src/ui/wheel_gesture_controller.js";

test("wheel controller coalesces one target and flushes before switching canvases", () => {
  const applied = [];
  const scheduled = [];
  let frameTask;
  let settled = 0;
  let timeoutTask;
  const classes = new Set();
  const controller = createWheelGestureController({
    canvas: { classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) } },
    apply: (sample) => applied.push({ ...sample }),
    onSettled: () => { settled += 1; },
    schedulerFactory(callback) {
      frameTask = callback;
      let pending;
      return {
        schedule(value) { pending = value; scheduled.push(value); },
        flush() { if (pending) callback(pending); pending = null; }
      };
    },
    timers: { clearTimeout() {}, setTimeout(task) { timeoutTask = task; return 1; } }
  });
  controller.queue({ mode: "single", clientX: 1, clientY: 2, deltaY: -1 });
  controller.queue({ mode: "single", clientX: 3, clientY: 4, deltaY: -1 });
  assert.equal(scheduled.at(-1).steps, -2);
  controller.queue({ mode: "compare", side: "left", clientX: 5, clientY: 6, deltaY: 1 });
  assert.deepEqual(applied[0], { mode: "single", clientX: 3, clientY: 4, deltaY: -1, steps: -2 });
  frameTask(scheduled.at(-1));
  timeoutTask();
  assert.equal(settled, 1);
  assert.equal(classes.has("is-view-interacting"), false);
});
