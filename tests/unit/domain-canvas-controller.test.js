import assert from "node:assert/strict";
import test from "node:test";
import { createDomainCanvas } from "../../src/ui/domain_canvas_controller.js";
import { formatViewportTransform } from "../../src/ui/viewport.js";

function withCanvas(run) {
  const originalRequest = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  const frames = new Map();
  let frameId = 0;
  globalThis.requestAnimationFrame = (callback) => { frames.set(++frameId, callback); return frameId; };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  let viewport = { x: 0, y: 0, scale: 1 }, painted = "";
  const listeners = {};
  const canvas = {
    classList: { add() {}, remove() {} },
    addEventListener(type, handler) { listeners[type] = handler; },
    removeEventListener(type) { delete listeners[type]; },
    setPointerCapture() {}, hasPointerCapture: () => true, releasePointerCapture() {}
  };
  const svg = { viewBox: { baseVal: { x: 0, y: 0, width: 200, height: 100 } },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }),
    querySelector: () => ({ setAttribute(_name, value) { painted = value; } }) };
  const controller = createDomainCanvas({ canvas, mount: { querySelector: () => svg },
    readViewport: () => viewport, writeViewport: (value) => { viewport = value; }, select() {}, save() {} });
  const fixture = { controller, listeners,
    read: () => ({ viewport: { ...viewport }, painted }),
    externalViewport(value) { viewport = value; },
    wheel() { controller.wheel({ deltaY: 100, clientX: 100, clientY: 50, preventDefault() {} }); },
    pan() { controller.pointerDown({ button: 0, pointerId: 1, clientX: 10, clientY: 10, target: { closest: () => null } }); },
    flush() { for (const [id, callback] of [...frames]) { frames.delete(id); callback(); } }
  };
  try { run(fixture); }
  finally {
    controller.stop();
    if (originalRequest) globalThis.requestAnimationFrame = originalRequest; else delete globalThis.requestAnimationFrame;
    if (originalCancel) globalThis.cancelAnimationFrame = originalCancel; else delete globalThis.cancelAnimationFrame;
  }
}

test("explicit Fit, Focus and external viewports supersede queued domain wheel work", () => {
  for (const action of ["fit", "focus", "apply"]) withCanvas((fixture) => {
    fixture.wheel();
    if (action === "focus") fixture.controller.focus({ x: 10, y: 10, width: 20, height: 20 });
    else if (action === "apply") {
      fixture.externalViewport({ x: 15, y: 20, scale: 1.5 });
      fixture.controller.apply();
    } else fixture.controller.fit();
    const explicit = fixture.read();
    fixture.flush();
    assert.deepEqual(fixture.read(), explicit, action);
    assert.equal(explicit.painted, formatViewportTransform(explicit.viewport));
  });
});

test("explicit Fit supersedes queued and subsequent frames from an earlier domain pan", () => withCanvas((fixture) => {
  fixture.pan();
  fixture.listeners.pointermove({ clientX: 30, clientY: 20 });
  fixture.controller.fit();
  const fitted = fixture.read();
  fixture.flush();
  fixture.listeners.pointermove({ clientX: 60, clientY: 35 });
  fixture.listeners.pointerup({ type: "pointerup" });
  assert.deepEqual(fixture.read(), fitted);
}));

test("starting a pan retains a preceding wheel step that has not reached its frame", () => withCanvas((fixture) => {
  fixture.wheel();
  fixture.pan();
  fixture.listeners.pointermove({ clientX: 30, clientY: 20 });
  fixture.listeners.pointerup({ type: "pointerup" });
  const result = fixture.read();
  assert.ok(result.viewport.scale < 1, "the preceding zoom-out survives the pan");
  assert.equal(result.painted, formatViewportTransform(result.viewport));
}));

test("wheel takes over a painted pan without a late pointer release replacing the zoom", () => withCanvas((fixture) => {
  fixture.pan();
  fixture.listeners.pointermove({ clientX: 30, clientY: 20 });
  fixture.flush();
  fixture.wheel();
  fixture.flush();
  const zoomed = fixture.read().painted;
  fixture.listeners.pointermove({ clientX: 60, clientY: 35 });
  fixture.listeners.pointerup({ type: "pointerup" });
  assert.equal(fixture.read().painted, zoomed);
  assert.deepEqual(fixture.read().viewport, { x: 20, y: 10, scale: 1 }, "the pan is committed before the wheel preview");
}));

test("resize consumers can read wheel and pan previews without persisting or mutating them", () => {
  for (const gesture of ["wheel", "pan"]) withCanvas((fixture) => {
    if (gesture === "wheel") fixture.wheel();
    else { fixture.pan(); fixture.listeners.pointermove({ clientX: 30, clientY: 20 }); }
    fixture.flush();
    const preview = fixture.controller.viewport();
    assert.equal(formatViewportTransform(preview), fixture.read().painted);
    assert.notDeepEqual(preview, fixture.read().viewport, "gesture previews remain uncommitted");
    preview.x = 999;
    assert.notEqual(fixture.controller.viewport().x, 999, "the read result cannot mutate the active preview");
    const resized = { x: 12, y: 17, scale: 1.3 };
    fixture.externalViewport(resized);
    fixture.controller.apply();
    if (gesture === "pan") fixture.listeners.pointerup({ type: "pointerup" });
    fixture.flush();
    assert.deepEqual(fixture.controller.viewport(), resized);
    assert.equal(fixture.read().painted, formatViewportTransform(resized));
  });
});

test("published resize previews replace stale gesture frames and become the next wheel baseline", () => withCanvas((fixture) => {
  fixture.wheel();
  const resized = { x: -10, y: -20, scale: 1.25 };
  fixture.controller.preview(resized);
  fixture.flush();
  assert.equal(fixture.read().painted, formatViewportTransform(resized));
  assert.deepEqual(fixture.read().viewport, { x: 0, y: 0, scale: 1 }, "publishing a resize preview does not persist it");
  resized.x = 999;
  assert.notEqual(fixture.controller.viewport().x, 999);
  fixture.wheel();
  fixture.flush();
  assert.equal(fixture.controller.viewport().scale, 1.25 / 1.12);
}));
