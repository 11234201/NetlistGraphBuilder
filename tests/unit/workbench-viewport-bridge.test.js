import assert from "node:assert/strict";
import test from "node:test";
import { createWorkbenchViewportBridge } from "../../src/app/workbench_viewport_bridge.js";
import { createHistoryController } from "../../src/app/history_controller.js";
import { formatViewportTransform } from "../../src/ui/viewport.js";

test("explicit non-history viewport commands leave pending user command metadata untouched", () => {
  const state = { pendingViewCommandMetadata: null };
  const history = createHistoryController({ state, elements: {}, services: {} });
  const result = { effects: { viewport: true, persist: true } };
  history.noteViewCommandDispatch({ type: "viewport.set", sessionId: "single:primary", recordHistory: false }, result);
  assert.equal(state.pendingViewCommandMetadata, null);
  history.noteViewCommandDispatch({ type: "selection.set", sessionId: "single:primary" }, result);
  const pending = state.pendingViewCommandMetadata;
  history.noteViewCommandDispatch({ type: "viewport.set", sessionId: "compare:left", recordHistory: false }, result);
  assert.equal(state.pendingViewCommandMetadata, pending);
  assert.deepEqual(pending, { label: "Select object", affectedSessionIds: ["single:primary"] });
  history.noteViewCommandDispatch({ type: "viewport.set", sessionId: "compare:right" }, result);
  assert.deepEqual(state.pendingViewCommandMetadata.affectedSessionIds, ["single:primary", "compare:right"]);
});

test("bridge commits both Compare viewports despite adapters reapplying the peer DOM", () => {
  let width = 1000;
  const commands = [];
  const views = ["left", "right"].map((id) => {
    const attributes = new Map();
    const content = { getAttribute: (name) => attributes.get(name), setAttribute: (name, value) => attributes.set(name, value) };
    const svg = {
      viewBox: { baseVal: { x: 0, y: 0, width: 1000, height: 500 } },
      getBoundingClientRect: () => ({ width, height: 600 }), querySelector: () => content
    };
    return { id, content, mount: { querySelector: () => svg }, viewport: { x: 0, y: 0, scale: 1 } };
  });
  const apply = () => views.forEach((view) => view.content.setAttribute("transform", formatViewportTransform(view.viewport)));
  apply();
  const bridge = createWorkbenchViewportBridge({
    readViews: () => views,
    singleViewSession: { dispatch() { throw new Error("unexpected Single dispatch"); } },
    compareViewSessions: { dispatch(id, command) { commands.push([id, command]); views.find((view) => view.id === id).viewport = command.viewport; } },
    applyTransform() { throw new Error("unexpected Single transform"); },
    applyCompareTransforms: apply,
    ResizeObserverClass: null, MutationObserverClass: null
  });
  bridge.onViewportResize({ phase: "before", reason: "resize", preview: true });
  width = 500;
  bridge.onViewportResize({ phase: "after", reason: "resize", preview: true });
  assert.deepEqual(commands, []);
  bridge.onViewportResize({ phase: "after", reason: "resize", preview: false });
  assert.equal(commands.length, 2);
  for (const [id, command] of commands) {
    assert.ok(["left", "right"].includes(id));
    assert.equal(command.type, "viewport.set");
    assert.equal(command.recordHistory, false);
    assert.deepEqual(command.viewport, { x: -500, y: -250, scale: 2 });
  }
  bridge.dispose();
});

test("resize compensation preserves Single and both Compare LOD states across the raw scale threshold", () => {
  for (const ids of [["single"], ["left", "right"]]) {
    for (const nextWidth of [500, 1500]) {
      let width = 1000;
      const views = ids.map((id, index) => {
        const attributes = new Map();
        const classes = new Set(index ? ["is-low-detail"] : []);
        const host = { classList: {
          contains: (name) => classes.has(name),
          toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name)
        } };
        const content = { getAttribute: (name) => attributes.get(name), setAttribute: (name, value) => attributes.set(name, value) };
        const svg = {
          viewBox: { baseVal: { x: 0, y: 0, width: 1000, height: 500 } },
          getBoundingClientRect: () => ({ width, height: 600 }), querySelector: () => content
        };
        return { id, content, host, mount: { querySelector: () => svg, closest: () => host }, viewport: { x: 0, y: 0, scale: index ? 0.6 : 0.75 } };
      });
      const paint = () => views.forEach((view) => {
        view.content.setAttribute("transform", formatViewportTransform(view.viewport));
        view.host.classList.toggle("is-low-detail", view.viewport.scale < 0.65);
      });
      paint();
      const originalLod = views.map((view) => view.host.classList.contains("is-low-detail"));
      const dispatch = (id, command) => { views.find((view) => view.id === id).viewport = command.viewport; };
      const bridge = createWorkbenchViewportBridge({
        readViews: () => views,
        singleViewSession: { dispatch: (command) => dispatch("single", command) },
        compareViewSessions: { dispatch }, applyTransform: paint, applyCompareTransforms: paint,
        ResizeObserverClass: null, MutationObserverClass: null
      });
      bridge.onViewportResize({ phase: "before", reason: "panel" });
      width = nextWidth;
      bridge.onViewportResize({ phase: "after", reason: "panel" });
      assert.deepEqual(views.map((view) => view.host.classList.contains("is-low-detail")), originalLod);
      if (nextWidth === 1500) assert.ok(views[0].viewport.scale < 0.65, "physical zoom compensation crosses the old raw threshold");
      if (nextWidth === 500 && ids.length === 2) assert.ok(views[1].viewport.scale > 0.65);
      bridge.dispose();
    }
  }
});
