import assert from "node:assert/strict";
import test from "node:test";
import { createCanvasResizeController } from "../../src/ui/canvas_resize_controller.js";
import { formatViewportTransform, getResizedViewportTransform } from "../../src/ui/viewport.js";

test("resize preserves world centre and physical magnification through either meet axis", () => {
  const viewport = { x: 100, y: -35, scale: 2.5 };
  const viewBox = { x: -50, y: 20, width: 1000, height: 400 };
  const before = { width: 1200, height: 500 };
  const after = { width: 600, height: 100 };
  const next = getResizedViewportTransform(viewport, viewBox, before, after);
  const fit = (size) => Math.min(size.width / viewBox.width, size.height / viewBox.height);
  assert.equal(next.scale * fit(after), viewport.scale * fit(before));
  for (const [axis, length] of [["x", "width"], ["y", "height"]]) {
    const center = viewBox[axis] + viewBox[length] / 2;
    assert.ok(Math.abs((center - next[axis]) / next.scale - (center - viewport[axis]) / viewport.scale) < 1e-10);
  }
  assert.deepEqual(getResizedViewportTransform(viewport, viewBox, before, { width: 0, height: 100 }), viewport);
  assert.deepEqual(getResizedViewportTransform(viewport, viewBox, after, after), viewport);
});

test("panel drag previews only DOM transforms and releases one final viewport command", () => {
  const fixture = createFixture();
  const controller = fixture.create();
  fixture.resize(controller, 500, true);
  assert.equal(fixture.commits.length, 0);
  assert.deepEqual(fixture.views[0].viewport, { x: 100, y: 50, scale: 2 });
  assert.equal(fixture.content.getAttribute("transform"), formatViewportTransform({ x: -300, y: -150, scale: 4 }));
  fixture.resize(controller, 400, true);
  fixture.resize(controller, 400, false);
  assert.deepEqual(fixture.commits, [["single", { x: -500, y: -250, scale: 5 }]]);
  controller.dispose();
});

test("new SVG and external viewport changes cannot inherit a stale resize baseline", () => {
  const fixture = createFixture();
  const controller = fixture.create();
  fixture.resize(controller, 500, true);
  fixture.views[0].viewport = { x: 20, y: 30, scale: 3 };
  fixture.content.setAttribute("transform", formatViewportTransform(fixture.views[0].viewport));
  controller.refresh();
  fixture.resize(controller, 400, false);
  assert.deepEqual(fixture.commits[0], ["single", { x: -100, y: -25, scale: 3.75 }]);
  fixture.replaceSvg();
  fixture.size.width = 1000;
  fixture.views[0].viewport = { x: 0, y: 0, scale: 1 };
  controller.refresh();
  fixture.resize(controller, 500, false);
  assert.deepEqual(fixture.commits[1], ["single", { x: -500, y: -250, scale: 2 }]);
  controller.dispose();
});

test("window resize uses cached old dimensions even when before arrives after browser reflow", () => {
  const fixture = createFixture();
  const controller = fixture.create();
  fixture.size.width = 500;
  controller.onViewportResize({ phase: "before", reason: "viewport" });
  controller.onViewportResize({ phase: "after", reason: "viewport", preview: false });
  assert.equal(fixture.commits.length, 0);
  fixture.flushTimers();
  assert.deepEqual(fixture.commits, [["single", { x: -300, y: -150, scale: 4 }]]);
  controller.dispose();
});

test("same-value Fit rebases changed dimensions before the ResizeObserver can compensate", () => {
  const fixture = createFixture();
  const observer = createObserverHarness();
  fixture.size.height = 400;
  fixture.views[0].viewport = { x: 0, y: 0, scale: 1 };
  fixture.content.setAttribute("transform", formatViewportTransform(fixture.views[0].viewport));
  const controller = fixture.create(observer.options);
  fixture.size.width = 500;
  fixture.size.height = 800;
  observer.notifyResize();
  assert.equal(observer.pendingFrames(), 1);
  controller.refresh();
  assert.equal(observer.pendingFrames(), 0);
  observer.notifyResize();
  observer.flushFrames();
  fixture.flushTimers();
  assert.deepEqual(fixture.commits, []);
  assert.equal(fixture.content.getAttribute("transform"), formatViewportTransform({ x: 0, y: 0, scale: 1 }));
  fixture.resize(controller, 250, false);
  assert.deepEqual(fixture.commits, [["single", { x: -500, y: -250, scale: 2 }]]);
  controller.dispose();
});

test("explicit rebase discards gesture and settle state while keeping future observation active", () => {
  const fixture = createFixture();
  const observer = createObserverHarness();
  const controller = fixture.create(observer.options);
  fixture.resize(controller, 500, true);
  fixture.views[0].viewport = { x: 0, y: 0, scale: 1 };
  fixture.content.setAttribute("transform", formatViewportTransform(fixture.views[0].viewport));
  controller.refresh();
  fixture.size.width = 400;
  observer.notifyResize();
  observer.flushFrames();
  assert.equal(fixture.pendingTimers(), 1, "the previous panel drag no longer suppresses observation settling");
  fixture.size.width = 250;
  fixture.content.setAttribute("transform", formatViewportTransform(fixture.views[0].viewport));
  controller.refresh();
  assert.equal(fixture.pendingTimers(), 0);
  fixture.flushTimers();
  assert.deepEqual(fixture.commits, []);
  fixture.size.width = 125;
  observer.notifyResize();
  observer.flushFrames();
  fixture.flushTimers();
  assert.deepEqual(fixture.commits, [["single", { x: -500, y: -250, scale: 2 }]]);
  controller.dispose();
});

test("hidden or replaced mounts are skipped and disposal cancels delayed commits", () => {
  const fixture = createFixture();
  const controller = fixture.create();
  fixture.size.width = 0;
  controller.refresh();
  fixture.size.width = 300;
  controller.onViewportResize({ phase: "after", reason: "viewport" });
  fixture.flushTimers();
  assert.deepEqual(fixture.commits, []);
  fixture.size.width = 200;
  controller.onViewportResize({ phase: "after", reason: "viewport" });
  controller.dispose();
  fixture.flushTimers();
  assert.deepEqual(fixture.commits, []);
});

function createFixture() {
  const size = { width: 1000, height: 600 };
  const attributes = new Map();
  const content = {
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, value)
  };
  const makeSvg = () => ({
    viewBox: { baseVal: { x: 0, y: 0, width: 1000, height: 500 } },
    getBoundingClientRect: () => ({ ...size }),
    querySelector: (selector) => selector === "#schematicContent" ? content : null
  });
  let svg = makeSvg();
  const mount = { querySelector: (selector) => selector === "svg" ? svg : null };
  const views = [{ id: "single", mount, viewport: { x: 100, y: 50, scale: 2 } }];
  content.setAttribute("transform", formatViewportTransform(views[0].viewport));
  const commits = [];
  const timers = new Map();
  let timerId = 0;
  return {
    size, content, views, commits,
    replaceSvg: () => { svg = makeSvg(); },
    pendingTimers: () => timers.size,
    create(options = {}) {
      return createCanvasResizeController({
        readViews: () => views,
        commit: (id, viewport) => { commits.push([id, viewport]); views.find((view) => view.id === id).viewport = viewport; },
        ResizeObserverClass: null, MutationObserverClass: null,
        windowTarget: {
          setTimeout: (callback) => { timers.set(++timerId, callback); return timerId; },
          clearTimeout: (id) => timers.delete(id)
        },
        ...options
      });
    },
    resize(controller, width, preview) {
      controller.onViewportResize({ phase: "before", reason: "resize", preview });
      size.width = width;
      controller.onViewportResize({ phase: "after", reason: "resize", preview });
    },
    flushTimers() {
      const callbacks = [...timers.values()];
      timers.clear();
      for (const callback of callbacks) callback();
    }
  };
}

function createObserverHarness() {
  let notify = () => {};
  let frameId = 0;
  const frames = new Map();
  return {
    options: {
      ResizeObserverClass: class {
        constructor(callback) { notify = callback; }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
      requestFrame: (callback) => { frames.set(++frameId, callback); return frameId; },
      cancelFrame: (id) => frames.delete(id)
    },
    notifyResize: () => notify(),
    pendingFrames: () => frames.size,
    flushFrames() {
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback();
    }
  };
}
