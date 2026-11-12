import assert from "node:assert/strict";
import test from "node:test";
import { createWorkbenchShell } from "../../src/ui/workbench_shell_controller.js";
import { resolveWorkbenchShellLayout } from "../../src/ui/workbench_shell_policy.js";
import { fitPopoverToViewport } from "../../src/ui/toolbar_popover_controller.js";

test("desktop panel defaults preserve the 1366 canvas budget and narrow layouts use one drawer", () => {
  const normal = resolveWorkbenchShellLayout(1366, {});
  assert.equal(normal.navigator.open, false);
  assert.equal(normal.inspector.open, true);
  assert.ok(1366 - normal.inspector.width - 6 >= 1000);
  assert.equal(resolveWorkbenchShellLayout(1920, {}).navigator.open, true);
  const saved = { navigatorOpen: true, inspectorOpen: true, inspectorWidth: 999 };
  const compact = resolveWorkbenchShellLayout(1024, saved, "navigator");
  assert.equal(compact.navigator.open, true);
  assert.equal(compact.inspector.open, false);
  assert.equal(compact.inspector.width, 560);
  assert.equal(resolveWorkbenchShellLayout(1920, saved).inspector.open, true);
});

test("panel changes bracket the DOM change and responsive hiding does not overwrite preferences", () => {
  const fixture = createFixture(1920);
  const controller = fixture.create({ navigatorOpen: true, inspectorOpen: true });
  assert.equal(fixture.elements.navigatorPanel.hidden, false);
  controller.setPanelOpen("inspector", false);
  assert.deepEqual(fixture.resizeEvents.map((event) => [event.phase, event.inspectorOpen]), [
    ["before", "true"], ["after", "false"]
  ]);
  fixture.windowTarget.innerWidth = 1024;
  fixture.windowTarget.dispatch("resize");
  fixture.frames.flush();
  assert.equal(fixture.elements.navigatorPanel.hidden, true);
  assert.equal(controller.getPreferences().navigatorOpen, true);
  assert.equal(fixture.saved.length, 1);
  controller.setPanelOpen("navigator", true);
  controller.setPanelOpen("inspector", true);
  assert.equal(fixture.elements.navigatorPanel.hidden, true);
  assert.equal(fixture.elements.inspectorPanel.hidden, false);
  controller.dispose();
});

test("both panels can stay hidden and each visible toolbar toggle restores its own panel", () => {
  const fixture = createFixture(1920);
  const controller = fixture.create();
  for (const panel of ["navigator", "inspector"]) {
    const name = panel === "navigator" ? "Navigator" : "Inspector";
    const toggle = fixture.elements[`toggle${name}Button`];
    assert.equal(toggle.getAttribute("aria-label"), `Hide ${name}`);
    toggle.dispatch("click");
    assert.equal(fixture.elements[`${panel}Panel`].hidden, true);
    assert.equal(fixture.elements[`${panel}Panel`].inert, true);
    assert.equal(fixture.elements[`${panel}ResizeHandle`].hidden, true);
    assert.equal(toggle.getAttribute("aria-label"), `Show ${name}`);
  }
  const saved = fixture.saved.at(-1);
  controller.dispose();
  const restored = createFixture(1920);
  const next = restored.create(saved);
  assert.equal(restored.elements.navigatorPanel.hidden, true);
  assert.equal(restored.elements.inspectorPanel.hidden, true);
  restored.elements.toggleNavigatorButton.dispatch("click");
  assert.equal(restored.elements.navigatorPanel.hidden, false);
  assert.equal(restored.elements.inspectorPanel.hidden, true);
  restored.elements.toggleInspectorButton.dispatch("click");
  assert.equal(restored.elements.inspectorPanel.hidden, false);
  next.dispose();
});

test("resize coalesces previews, commits storage once, and disposal cancels pending work", () => {
  const fixture = createFixture(1920);
  const controller = fixture.create();
  const handle = fixture.elements.inspectorResizeHandle;
  handle.dispatch("pointerdown", { button: 0, pointerId: 4, clientX: 1500 });
  handle.dispatch("pointermove", { clientX: 1490 });
  handle.dispatch("pointermove", { clientX: 1470 });
  assert.equal(fixture.saved.length, 0);
  assert.equal(fixture.resizeEvents.length, 0);
  fixture.frames.flush();
  assert.equal(controller.getPreferences().inspectorWidth, 366);
  assert.equal(fixture.resizeEvents.length, 2);
  handle.dispatch("pointerup");
  assert.equal(fixture.saved.length, 1);
  assert.equal(handle.captured, null);
  handle.dispatch("pointerdown", { button: 0, pointerId: 5, clientX: 1500 });
  handle.dispatch("pointermove", { clientX: 1400 });
  controller.dispose();
  fixture.frames.flush();
  assert.equal(fixture.saved.length, 1);
  assert.equal(fixture.document.listenerCount(), 0);
  assert.equal(handle.listenerCount(), 0);
  assert.equal(fixture.windowTarget.listenerCount(), 0);
});

test("search shortcut leaves editable targets alone and Escape returns drawer focus", () => {
  const fixture = createFixture(1024);
  const controller = fixture.create();
  fixture.document.dispatch("keydown", { key: "/", target: fixture.elements.workspace });
  assert.equal(fixture.document.activeElement, fixture.elements.searchInput);
  fixture.elements.workspace.focus();
  fixture.document.dispatch("keydown", { key: "/", target: { closest: () => ({}) } });
  assert.equal(fixture.document.activeElement, fixture.elements.workspace);
  controller.setPanelOpen("inspector", true);
  fixture.document.dispatch("keydown", { key: "Escape", target: fixture.elements.inspectorPanel });
  assert.equal(fixture.elements.inspectorPanel.hidden, true);
  assert.equal(fixture.document.activeElement, fixture.elements.toggleInspectorButton);
  controller.selectNavigatorTab("design");
  assert.equal(fixture.elements.designPanel.hidden, false);
  assert.equal(fixture.elements.hierarchyPanel.hidden, true);
  controller.dispose();
});

test("hierarchy opens only when requested and remains lazy in a hidden navigator or Design tab", () => {
  const fixture = createFixture(1920);
  const controller = fixture.create();
  const menu = fixture.elements.moduleHierarchyMenu;
  assert.equal(menu.open, true);
  menu.open = false;
  controller.refresh();
  assert.equal(menu.open, false, "resize must not undo module navigation's disclosure close");
  controller.selectNavigatorTab("design");
  assert.equal(menu.open, false);
  controller.selectNavigatorTab("hierarchy");
  assert.equal(menu.open, true);
  controller.setPanelOpen("navigator", false);
  assert.equal(menu.open, false);
  controller.setPanelOpen("navigator", true);
  assert.equal(menu.open, true);
  controller.dispose();
});

test("toolbar menu is constrained at the left edge and flips above a low trigger", () => {
  const left = fitPopoverToViewport({ left: 14, top: 50, bottom: 84 }, { width: 176, height: 150 }, { width: 1440, height: 900 });
  assert.equal(left.left, 14);
  assert.equal(left.top, 90);
  const bottom = fitPopoverToViewport({ left: 1370, top: 850, bottom: 884 }, { width: 320, height: 250 }, { width: 1440, height: 900 });
  assert.equal(bottom.left, 1112);
  assert.ok(bottom.top + 250 < 850);
});

function createFixture(width) {
  const document = new Target();
  const windowTarget = new Target();
  windowTarget.innerWidth = width;
  windowTarget.innerHeight = 900;
  const names = ["shell", "workspace", "navigatorPanel", "inspectorPanel", "toggleNavigatorButton", "toggleInspectorButton", "selectionSummaryButton", "navigatorResizeHandle", "inspectorResizeHandle", "searchInput", "hierarchyTab", "designTab", "hierarchyPanel", "designPanel", "moduleHierarchyMenu"];
  const elements = Object.fromEntries(names.map((name) => [name, new Target(document)]));
  for (const tab of ["hierarchy", "design"]) {
    elements[`${tab}Tab`].setAttribute("data-nav-tab", tab);
    elements[`${tab}Panel`].setAttribute("data-nav-panel", tab);
  }
  document.querySelector = (selector) => selector === ".app-shell" ? elements.shell
    : selector === ".workspace" ? elements.workspace : elements[selector.slice(1)] || null;
  document.querySelectorAll = (selector) => selector === "[data-nav-tab]" ? [elements.hierarchyTab, elements.designTab]
    : selector === "[data-nav-panel]" ? [elements.hierarchyPanel, elements.designPanel] : [];
  const frames = new Frames();
  const saved = [], resizeEvents = [];
  return {
    document, windowTarget, elements, frames, saved, resizeEvents,
    create(initial = {}) {
      return createWorkbenchShell({
        document, windowTarget,
        preferences: { load: () => initial, save: (value) => saved.push(value) },
        onViewportResize: (event) => resizeEvents.push({ ...event, inspectorOpen: elements.workspace.getAttribute("data-inspector-open") }),
        ...frames.options()
      });
    }
  };
}

class Target {
  constructor(document) {
    this.document = document;
    this.listeners = new Map();
    this.attributes = new Map();
    this.style = { setProperty() {}, removeProperty() {} };
    this.classList = { add() {}, remove() {}, toggle() {} };
    this.captured = null;
  }
  addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(listener); }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  dispatch(type, fields = {}) {
    const event = { target: this, preventDefault() { this.defaultPrevented = true; }, ...fields };
    for (const listener of [...(this.listeners.get(type) || [])]) listener(event);
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  contains(target) { return target === this; }
  closest() { return null; }
  focus() { this.document.activeElement = this; }
  setPointerCapture(id) { this.captured = id; }
  hasPointerCapture(id) { return this.captured === id; }
  releasePointerCapture() { this.captured = null; }
  listenerCount() { return [...this.listeners.values()].reduce((count, listeners) => count + listeners.size, 0); }
}

class Frames {
  constructor() { this.callbacks = new Map(); this.id = 0; }
  options() {
    return {
      requestFrame: (callback) => { this.callbacks.set(++this.id, callback); return this.id; },
      cancelFrame: (id) => this.callbacks.delete(id)
    };
  }
  flush() {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of callbacks) callback();
  }
}
