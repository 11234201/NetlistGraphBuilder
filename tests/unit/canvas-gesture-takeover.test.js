import assert from "node:assert/strict";
import test from "node:test";
import { startCanvasPan } from "../../src/ui/canvas_pan_controller.js";
import { createWheelGestureController } from "../../src/ui/wheel_gesture_controller.js";
import { createCanvasController } from "../../src/app/canvas_controller.js";
import { createDomainCanvas } from "../../src/ui/domain_canvas_controller.js";

function fixture() {
  const listeners = new Map(), classes = new Set();
  const canvas = { classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) },
    addEventListener: (name, task) => listeners.set(name, task), removeEventListener: (name) => listeners.delete(name),
    setPointerCapture() {}, hasPointerCapture: () => true, releasePointerCapture() {} };
  const svg = { viewBox: { baseVal: { width: 200, height: 100 } }, getBoundingClientRect: () => ({ width: 200, height: 100 }) };
  let viewport = { x: 0, y: 0, scale: 1 };
  const wheel = createWheelGestureController({ canvas, apply() { viewport = { ...viewport, scale: 2 }; } });
  function pan() {
    startCanvasPan({ target: canvas, svg, event: { pointerId: 1, clientX: 10, clientY: 10 }, transform: viewport,
      commit(value) { viewport = value; } });
    listeners.get("pointermove")({ pointerId: 1, clientX: 30, clientY: 20 });
    return listeners.get("pointermove");
  }
  return { canvas, svg, wheel, classes, listeners, pan, read: () => viewport, write: (value) => { viewport = value; } };
}

test("wheel takes over the last queued pan and rejects subsequent old pointer moves", () => {
  const f = fixture(), stale = f.pan();
  f.wheel.queue({ mode: "single", clientX: 10, clientY: 10, deltaY: -1 });
  assert.deepEqual(f.read(), { x: 20, y: 10, scale: 1 });
  assert.equal(f.classes.has("is-panning"), false);
  assert.equal(f.listeners.size, 0);
  f.wheel.flush(); stale({ pointerId: 1, clientX: 80, clientY: 80 });
  assert.deepEqual(f.read(), { x: 20, y: 10, scale: 2 });
  assert.equal(f.classes.size, 0);
});

test("a following pan reads its origin after the previous final frame commits", () => {
  const f = fixture();
  f.pan();
  startCanvasPan({ target: f.canvas, svg: f.svg, event: { pointerId: 2, clientX: 30, clientY: 20 },
    transform: f.read(), readTransform: f.read, commit: f.write });
  f.listeners.get("pointermove")({ pointerId: 2, clientX: 40, clientY: 30 });
  f.listeners.get("pointerup")({ pointerId: 2, type: "pointerup" });
  assert.deepEqual(f.read(), { x: 30, y: 20, scale: 1 });
});

test("a new domain viewport discards pending legacy gestures on the shared canvas", (t) => {
  for (const kind of ["pan", "wheel"]) {
    const f = fixture();
    t.after(() => { f.listeners.get("pointercancel")?.({ type: "pointercancel" }); f.wheel.flush(); });
    const stale = kind === "pan" ? f.pan() : () => {};
    if (kind === "wheel") f.wheel.queue({ mode: "single", deltaY: -1 });
    let painted;
    f.svg.querySelector = () => ({ setAttribute(_key, value) { painted = value; } });
    const domain = createDomainCanvas({ canvas: f.canvas, mount: { querySelector: () => f.svg },
      readViewport: () => ({ x: 100, y: 50, scale: 3 }), writeViewport() { assert.fail("replacement must not persist the old gesture"); },
      select() {}, save() { assert.fail("replacement must not save"); } });
    domain.apply();
    assert.equal(f.classes.size, 0, `${kind}: transient styling must be released immediately`);
    assert.equal(f.listeners.size, 0);
    stale({ pointerId: 1, clientX: 100, clientY: 80 }); f.wheel.flush();
    assert.deepEqual(f.read(), { x: 0, y: 0, scale: 1 }, "unpainted old input must be discarded");
    assert.equal(painted, "scale(3) translate(33.333 16.667)");
  }
});

test("Fit ends active pan or queued wheel work in Single and Compare", () => {
  for (const compare of [false, true]) for (const kind of ["pan", "wheel"]) {
    const f = fixture(), updates = [];
    const controller = createCanvasController({ state: { compare: { active: compare } }, elements: { canvas: f.canvas },
      services: { wheelGestureController: f.wheel, applyTransform() {}, applyCompareTransforms() {}, setStatus() {}, recordViewHistory() {},
        setSingleTransform(value) { f.write(value); }, setCompareTransform(side, value) { updates.push([side, value]); f.write(value); } } });
    const stale = kind === "pan" ? f.pan() : () => {};
    if (kind === "wheel") f.wheel.queue({ mode: "single", deltaY: -1 });
    controller.fitToView(); f.wheel.flush(); stale({ pointerId: 1, clientX: 90, clientY: 80 });
    assert.deepEqual(f.read(), { x: 0, y: 0, scale: 1 });
    assert.equal(f.classes.size, 0);
    assert.equal(f.listeners.size, 0);
    if (compare) assert.deepEqual(updates.map(([side]) => side), ["left", "right"]);
  }
});
