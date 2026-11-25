import assert from "node:assert/strict";
import test from "node:test";
import { createInspectorTabsController } from "../../src/ui/inspector_tabs_controller.js";

function element(dataset = {}) {
  const listeners = new Map();
  const properties = new Map();
  return { dataset, attributes: {}, hidden: false, scrollTop: 0, listeners,
    style: {
      setProperty(key, value) { properties.set(key, value); },
      getPropertyValue(key) { return properties.get(key) || ""; },
      removeProperty(key) { properties.delete(key); }
    },
    setAttribute(key, value) { this.attributes[key] = value; },
    prepend(child) { child.parentElement = this; },
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type, callback) { if (listeners.get(type) === callback) listeners.delete(type); },
    classList: { toggle() {} }, focus() { this.focused = true; } };
}

function fixture() {
  const container = element();
  const scroll = element();
  const summaryButton = element();
  let panels = [element({ inspectorSection: "connections" }), element({ inspectorSection: "timing" })];
  let summary = element({ selectionIdentity: "module-a:u0" });
  let summaryHeight = null;
  let measurements = 0;
  const label = { textContent: "u0" };
  summary.querySelector = () => label;
  const status = { textContent: "" };
  let nav = null;
  container.id = "selectionDetails";
  container.ownerDocument = { createElement() {
    const created = element();
    created.buttons = [];
    Object.defineProperty(created, "innerHTML", { set(html) {
      created.buttons = [...html.matchAll(/data-inspector-tab="([^"]+)"/g)].map((match) => element({ inspectorTab: match[1] }));
    } });
    created.remove = () => { nav = null; };
    return created;
  } };
  container.insertBefore = (value) => { nav = value; };
  container.querySelector = (selector) => selector === "[data-inspector-summary]" ? summary
    : selector === "[data-inspector-tabs]" ? nav : selector === "[data-inspector-copy-status]" ? status : null;
  container.querySelectorAll = (selector) => selector === "[data-inspector-section]" ? panels : nav?.buttons || [];
  container.contains = () => true;
  let observer;
  let frameId = 0;
  const frames = new Map();
  class Observer {
    constructor(callback) { this.callback = callback; observer = this; }
    observe() { this.observing = true; }
    disconnect() { this.observing = false; }
  }
  return { container, scroll, summaryButton, status, Observer,
    scheduler: { requestFrame(callback) { frames.set(++frameId, callback); return frameId; }, cancelFrame(id) { frames.delete(id); } },
    flush() { for (const [id, callback] of [...frames]) { frames.delete(id); callback(); } },
    panels: () => panels, buttons: () => nav?.buttons || [], observer: () => observer,
    summary: () => summary,
    measurements: () => measurements,
    setSummaryHeight(height) {
      summaryHeight = height;
      summary.getBoundingClientRect = () => { measurements++; return { height: summaryHeight }; };
    },
    replace(id, available = ["connections", "timing"]) {
      panels = available.map((tab) => element({ inspectorSection: tab }));
      summary = element({ selectionIdentity: id });
      label.textContent = id;
      summary.querySelector = () => label;
      nav = null;
      observer.callback();
    },
    clear() { summary = null; panels = []; nav = null; observer.callback(); },
    async click(target, selector) { await container.listeners.get("click")({ target: { closest: (requested) => requested === selector ? target : null } }); }
  };
}

test("inspector keeps an applicable tab and same-object scroll across content replacements", () => {
  const view = fixture();
  const preferences = [];
  const controller = createInspectorTabsController({ container: view.container, scrollContainer: view.scroll,
    summaryButton: view.summaryButton, initialTab: "timing", onTabChange: (tab) => preferences.push(tab), MutationObserverClass: view.Observer, ...view.scheduler });
  view.flush();
  assert.equal(view.panels()[0].hidden, true);
  assert.equal(view.panels()[1].hidden, false);
  assert.equal(view.buttons()[1].attributes["aria-selected"], "true");
  view.scroll.scrollTop = 150;
  view.scroll.listeners.get("scroll")();
  view.replace("module-a:u0");
  view.flush();
  assert.equal(view.scroll.scrollTop, 150);
  assert.equal(view.panels()[1].hidden, false);
  view.replace("module-b:u0", ["connections"]);
  view.flush();
  assert.equal(view.scroll.scrollTop, 0);
  assert.equal(view.panels()[0].hidden, false);
  assert.equal(view.summaryButton.textContent, "module-b:u0");
  assert.deepEqual(preferences, [], "DOM projection must not persist a new preference");
  controller.dispose();
  assert.equal(view.observer().observing, false);
  assert.equal(view.container.listeners.size, 0);
  assert.equal(view.scroll.listeners.size, 0);
});

test("inspector tab keyboard navigation updates roving focus and one UI preference", () => {
  const view = fixture();
  const preferences = [];
  const controller = createInspectorTabsController({ container: view.container, onTabChange: (tab) => preferences.push(tab), MutationObserverClass: view.Observer });
  const current = view.buttons()[0];
  let prevented = false;
  view.container.listeners.get("keydown")({ key: "ArrowRight", target: { closest: () => current }, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(view.buttons()[1].focused, true);
  assert.equal(view.buttons()[0].tabIndex, -1);
  assert.equal(view.panels()[1].hidden, false);
  assert.deepEqual(preferences, ["timing"]);
  assert.equal(controller.selectTab("adjust"), false);
  view.replace("module-a:u0", ["connections", "attributes", "analysis", "timing"]);
  assert.equal(controller.selectTab("attributes"), true);
  assert.equal(view.panels()[1].hidden, false);
  assert.equal(controller.selectTab("analysis"), true);
  assert.equal(view.panels()[2].hidden, false);
  controller.dispose();
});

test("analysis content retains its identity across selection changes and follows tab visibility", () => {
  const view = fixture();
  const detail = {};
  const controller = createInspectorTabsController({ container: view.container, sectionContent: { analysis: detail },
    MutationObserverClass: view.Observer });
  view.replace("first", ["connections", "analysis"]);
  const first = view.panels()[1];
  assert.equal(detail.parentElement, first);
  assert.ok(first.hidden);
  controller.selectTab("analysis");
  view.replace("second", ["connections", "analysis"]);
  assert.equal(detail.parentElement, view.panels()[1]);
  assert.equal(detail.parentElement.hidden, false);
  controller.selectTab("connections");
  assert.ok(detail.parentElement.hidden);
  controller.dispose();
});

test("name copying uses the canonical text and handles a rejected clipboard promise", async () => {
  const view = fixture();
  const copied = [];
  const failures = [];
  const error = new Error("clipboard blocked");
  const controller = createInspectorTabsController({ container: view.container, MutationObserverClass: view.Observer,
    onCopyError: (details) => { failures.push(details); throw new Error("sink unavailable"); },
    copyText: async (text) => { copied.push(text); if (copied.length > 1) throw error; } });
  const copy = element({ inspectorCopy: "top/escaped canonical[2]" });
  await view.click(copy, "[data-inspector-copy]");
  assert.equal(copied[0], "top/escaped canonical[2]");
  assert.equal(view.status.textContent, "Canonical name copied.");
  await view.click(copy, "[data-inspector-copy]");
  assert.match(view.status.textContent, /Copy unavailable/);
  assert.deepEqual(failures, [{ operation: "inspector.copy", error, code: "CLIPBOARD_WRITE_FAILED",
    selectionIdentity: view.summary().dataset.selectionIdentity }]);
  controller.dispose();
});

test("sticky summary height follows resizing without changing the current tab or scroll", () => {
  const view = fixture();
  let resizeObserver;
  class ResizeObserver {
    constructor(callback) { this.callback = callback; resizeObserver = this; }
    observe(target) { this.target = target; }
    disconnect() { this.target = null; }
  }
  view.setSummaryHeight(88.5);
  const controller = createInspectorTabsController({ container: view.container, scrollContainer: view.scroll,
    initialTab: "timing", MutationObserverClass: view.Observer, ResizeObserverClass: ResizeObserver });
  assert.equal(view.measurements(), 0, "refresh must not force layout after replacing content");
  resizeObserver.callback([{ target: view.summary(), borderBoxSize: [{ blockSize: 88.5 }] }]);
  assert.equal(view.container.style.getPropertyValue("--inspector-summary-height"), "88.5px");
  assert.equal(resizeObserver.target, view.summary());
  view.scroll.scrollTop = 140;
  view.scroll.listeners.get("scroll")();
  view.setSummaryHeight(124);
  resizeObserver.callback([{ target: view.summary(), borderBoxSize: [{ blockSize: 124 }] }]);
  assert.equal(view.measurements(), 0, "use the delivered border box, including padding/borders");
  assert.equal(view.container.style.getPropertyValue("--inspector-summary-height"), "124px");
  assert.equal(view.scroll.scrollTop, 140, "summary reflow must not reset reading position");
  assert.equal(view.panels()[1].hidden, false);
  controller.dispose();
  assert.equal(resizeObserver.target, null, "dispose must release the active summary");
  assert.equal(view.container.style.getPropertyValue("--inspector-summary-height"), "");
});

test("summary replacement and empty selection release old size observation; dispose ignores queued callbacks", () => {
  const view = fixture();
  let resizeObserver;
  class ResizeObserver {
    constructor(callback) { this.callback = callback; this.disconnects = 0; resizeObserver = this; }
    observe(target) { this.target = target; }
    disconnect() { this.target = null; this.disconnects++; }
  }
  view.setSummaryHeight(90);
  const controller = createInspectorTabsController({ container: view.container,
    MutationObserverClass: view.Observer, ResizeObserverClass: ResizeObserver });
  const oldSummary = view.summary();
  resizeObserver.callback([{ target: oldSummary, borderBoxSize: [{ blockSize: 90 }] }]);
  const disconnects = resizeObserver.disconnects;
  view.replace("module-b:u1");
  assert.equal(resizeObserver.disconnects, disconnects + 1);
  assert.equal(resizeObserver.target, view.summary());
  assert.equal(view.container.style.getPropertyValue("--inspector-summary-height"), "90px", "retain the last size until the new summary is laid out");
  view.setSummaryHeight(116);
  resizeObserver.callback([{ target: oldSummary }]);
  assert.equal(view.container.style.getPropertyValue("--inspector-summary-height"), "90px", "stale observer entries cannot update the new summary");
  resizeObserver.callback([{ target: view.summary() }]);
  assert.equal(view.container.style.getPropertyValue("--inspector-summary-height"), "116px");
  const currentSummary = view.summary();
  view.clear();
  assert.equal(resizeObserver.target, null);
  assert.equal(view.container.style.getPropertyValue("--inspector-summary-height"), "0px");
  controller.dispose();
  assert.equal(resizeObserver.target, null);
  assert.equal(view.container.style.getPropertyValue("--inspector-summary-height"), "");
  resizeObserver.callback([{ target: currentSummary }]);
  view.observer().callback();
  assert.equal(view.container.style.getPropertyValue("--inspector-summary-height"), "", "disposal must prevent queued DOM work");
});

test("without ResizeObserver, summary measurements coalesce after DOM updates and cancel on disposal", () => {
  const view = fixture();
  const controller = createInspectorTabsController({ container: view.container,
    MutationObserverClass: view.Observer, ResizeObserverClass: null, ...view.scheduler });
  view.flush();
  assert.equal(view.container.style.getPropertyValue("--inspector-summary-height"), "0px");
  view.setSummaryHeight(72);
  controller.refresh();
  controller.refresh();
  assert.equal(view.measurements(), 0);
  view.flush();
  assert.equal(view.measurements(), 1);
  assert.equal(view.container.style.getPropertyValue("--inspector-summary-height"), "72px");
  controller.refresh();
  controller.dispose();
  view.flush();
  assert.equal(view.measurements(), 1);
});

test("panel refresh retains tab focus and restores saved scroll only after layout", () => {
  const view = fixture();
  let resizeObserver;
  class ResizeObserver {
    constructor(callback) { this.callback = callback; resizeObserver = this; }
    observe() {}
    disconnect() {}
  }
  const deliver = () => resizeObserver.callback([{ target: view.summary(), borderBoxSize: [{ blockSize: 80 }] }]);
  const controller = createInspectorTabsController({ container: view.container, scrollContainer: view.scroll,
    MutationObserverClass: view.Observer, ResizeObserverClass: ResizeObserver });
  deliver();
  const button = view.buttons()[0];
  button.focus();
  view.scroll.scrollTop = 120;
  view.scroll.listeners.get("scroll")();
  controller.refresh();
  assert.equal(view.buttons()[0], button);
  assert.equal(button.focused, true);
  view.scroll.scrollTop = 0;
  view.scroll.listeners.get("scroll")();
  deliver();
  assert.equal(view.scroll.scrollTop, 120, "ignore clamping events while a refresh awaits layout");
  view.replace("module-b:u1");
  assert.equal(view.scroll.scrollTop, 120, "refresh itself performs no synchronous scroll write");
  deliver();
  assert.equal(view.scroll.scrollTop, 0, "a different selection starts at the top");
  controller.dispose();
});
