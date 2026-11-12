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
  class Observer {
    constructor(callback) { this.callback = callback; observer = this; }
    observe() { this.observing = true; }
    disconnect() { this.observing = false; }
  }
  return { container, scroll, summaryButton, status, Observer,
    panels: () => panels, buttons: () => nav?.buttons || [], observer: () => observer,
    summary: () => summary,
    setSummaryHeight(height) {
      summaryHeight = height;
      summary.getBoundingClientRect = () => ({ height: summaryHeight });
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
    summaryButton: view.summaryButton, initialTab: "timing", onTabChange: (tab) => preferences.push(tab), MutationObserverClass: view.Observer });
  assert.equal(view.panels()[0].hidden, true);
  assert.equal(view.panels()[1].hidden, false);
  assert.equal(view.buttons()[1].attributes["aria-selected"], "true");
  view.scroll.scrollTop = 150;
  view.scroll.listeners.get("scroll")();
  view.replace("module-a:u0");
  assert.equal(view.scroll.scrollTop, 150);
  assert.equal(view.panels()[1].hidden, false);
  view.replace("module-b:u0", ["connections"]);
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
  controller.dispose();
});

test("name copying uses the canonical text and handles a rejected clipboard promise", async () => {
  const view = fixture();
  const copied = [];
  const controller = createInspectorTabsController({ container: view.container, MutationObserverClass: view.Observer,
    copyText: async (text) => { copied.push(text); if (copied.length > 1) throw new Error("clipboard blocked"); } });
  const copy = element({ inspectorCopy: "top/escaped canonical[2]" });
  await view.click(copy, "[data-inspector-copy]");
  assert.equal(copied[0], "top/escaped canonical[2]");
  assert.equal(view.status.textContent, "Canonical name copied.");
  await view.click(copy, "[data-inspector-copy]");
  assert.match(view.status.textContent, /Copy unavailable/);
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
  assert.equal(view.container.style.getPropertyValue("--inspector-summary-height"), "88.5px");
  assert.equal(resizeObserver.target, view.summary());
  view.scroll.scrollTop = 140;
  view.scroll.listeners.get("scroll")();
  view.setSummaryHeight(124);
  resizeObserver.callback([{ target: view.summary() }]);
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
  const disconnects = resizeObserver.disconnects;
  view.replace("module-b:u1");
  assert.equal(resizeObserver.disconnects, disconnects + 1);
  assert.equal(resizeObserver.target, view.summary());
  assert.equal(view.container.style.getPropertyValue("--inspector-summary-height"), "0px", "unmeasured mock summary is supported");
  view.setSummaryHeight(116);
  resizeObserver.callback([{ target: oldSummary }]);
  assert.equal(view.container.style.getPropertyValue("--inspector-summary-height"), "0px", "stale observer entries cannot update the new summary");
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

test("summary measurement works on refresh without ResizeObserver or DOM geometry", () => {
  const view = fixture();
  const controller = createInspectorTabsController({ container: view.container,
    MutationObserverClass: view.Observer, ResizeObserverClass: null });
  assert.equal(view.container.style.getPropertyValue("--inspector-summary-height"), "0px");
  view.setSummaryHeight(72);
  controller.refresh();
  assert.equal(view.container.style.getPropertyValue("--inspector-summary-height"), "72px");
  controller.dispose();
});
