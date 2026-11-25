import assert from "node:assert/strict";
import test from "node:test";
import { createWheelGestureController } from "../../src/ui/wheel_gesture_controller.js";
import { createLatestFrameScheduler } from "../../src/ui/frameScheduler.js";

function fixture({ onApply = () => {}, composited = false } = {}) {
  const frames = new Map(), timers = new Map(), applied = [], events = [], classes = new Set();
  let next = 0;
  const controller = createWheelGestureController({
    canvas: { querySelector: () => composited, classList: {
      add(name) { classes.add(name); events.push("start"); },
      remove(name) { classes.delete(name); events.push("end"); }
    } },
    apply(sample) { onApply(sample); applied.push({ ...sample }); events.push("apply"); },
    onSettled() { events.push("persist"); },
    schedulerFactory: (callback) => createLatestFrameScheduler(callback, {
      requestFrame(task) { frames.set(++next, task); return next; },
      cancelFrame(id) { frames.delete(id); }
    }),
    timers: { setTimeout(task) { timers.set(++next, task); return next; }, clearTimeout(id) { timers.delete(id); } }
  });
  return { controller, frames, timers, applied, events, classes,
    queue(value = {}) { controller.queue({ mode: "single", clientX: 1, clientY: 2, deltaY: -1, ...value }); },
    frame() { const ready = [...frames.entries()]; for (const [id, task] of ready) if (frames.delete(id)) task(); },
    idle() { const ready = [...timers.entries()]; for (const [id, task] of ready) if (timers.delete(id)) task(); }
  };
}

test("wheel controller coalesces one target and flushes before switching canvases", () => {
  const f = fixture();
  f.queue(); f.queue({ clientX: 3, clientY: 4 });
  f.queue({ mode: "compare", side: "left", clientX: 5, clientY: 6, deltaY: 1 });
  assert.deepEqual(f.applied[0], { mode: "single", clientX: 3, clientY: 4, deltaY: -1, steps: -2 });
  f.frame(); f.frame(); f.idle();
  assert.equal(f.applied[1].steps, 1);
  assert.deepEqual(f.events, ["start", "apply", "apply", "end", "persist"]);
  assert.equal(f.classes.size, 0);
});

test("a slow zoom frame cannot exhaust the idle interval before it is painted", () => {
  const f = fixture();
  f.queue(); f.idle();
  assert.equal(f.timers.size, 0, "no idle timer while zoom is still queued");
  f.frame(); f.idle();
  assert.equal(f.classes.has("is-view-interacting"), true);
  assert.equal(f.timers.size, 0, "wait for the following frame, not just the transform write");
  f.frame();
  assert.equal(f.timers.size, 1);
  f.idle();
  assert.deepEqual(f.events, ["start", "apply", "end", "persist"]);
});

test("new wheel input invalidates stale settlement without toggling detail classes", () => {
  const f = fixture();
  f.queue(); f.frame(); f.frame();
  const stale = [...f.timers.values()][0];
  f.queue(); stale(); f.idle();
  assert.deepEqual(f.events, ["start", "apply"]);
  f.frame(); f.frame(); f.idle();
  assert.deepEqual(f.events, ["start", "apply", "apply", "end", "persist"]);
});

test("explicit flush commits pending zoom once and cancels all delayed settlement", () => {
  for (const renderedFrames of [0, 1, 2]) {
    const f = fixture();
    f.queue();
    for (let i = 0; i < renderedFrames; i++) f.frame();
    const stale = [...f.timers.values()][0];
    f.controller.flush(); stale?.(); f.frame(); f.idle();
    assert.deepEqual(f.events, ["start", "apply", "end"]);
    assert.equal(f.frames.size + f.timers.size, 0);
  }
});

test("replacement cancellation discards queued zoom and invalidates delayed settlement", () => {
  for (const renderedFrames of [0, 1, 2]) {
    const f = fixture();
    f.queue();
    for (let i = 0; i < renderedFrames; i++) f.frame();
    const stale = [...f.timers.values()][0];
    f.controller.cancel(); f.frame(); f.idle(); stale?.();
    assert.equal(f.applied.length, renderedFrames ? 1 : 0);
    assert.equal(f.classes.size, 0);
    assert.equal(f.frames.size + f.timers.size, 0);
    assert.ok(!f.events.includes("persist"));
    f.queue(); stale?.();
    assert.equal(f.classes.has("is-view-interacting"), true, "old completion cannot end a new gesture");
    f.frame(); f.frame(); f.idle();
    assert.equal(f.events.filter((event) => event === "persist").length, 1);
  }
});

test("a failed viewport apply releases preview styling and scheduled completion", () => {
  const f = fixture({ onApply() { throw new Error("surface unavailable"); } });
  f.queue();
  assert.throws(() => f.frame(), /surface unavailable/);
  f.frame(); f.idle();
  assert.equal(f.classes.size, 0);
  assert.equal(f.frames.size + f.timers.size, 0);
  assert.deepEqual(f.events, ["start", "end"]);
});

test("composited wheel settlement yields to pending input and cancels an obsolete paint confirmation", () => {
  const f = fixture({ composited: true });
  f.queue(); f.frame(); f.frame(); f.idle(); f.frame();
  assert.ok(f.classes.has("is-view-interacting"));
  f.queue(); f.frame(); f.frame(); f.idle();
  assert.ok(!f.events.includes("persist"));
  f.frame(); f.frame();
  assert.deepEqual(f.events, ["start", "apply", "apply", "end", "persist"]);
  f.queue(); f.frame(); f.frame(); f.idle(); f.controller.cancel();
  f.frame(); f.frame();
  assert.equal(f.events.filter((event) => event === "persist").length, 1);
  assert.equal(f.frames.size + f.timers.size, 0);
});
