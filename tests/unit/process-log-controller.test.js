import assert from "node:assert/strict";
import test from "node:test";
import { createProcessLogController } from "../../src/ui/process_log_controller.js";

function control(value = "") {
  const listeners = {};
  return {
    value,
    hidden: false,
    checked: false,
    textContent: "",
    innerHTML: "",
    scrollTop: 0,
    scrollHeight: 20,
    attributes: {},
    addEventListener: (type, handler) => { listeners[type] = handler; },
    setAttribute(name, next) { this.attributes[name] = next; },
    fire(type) { return listeners[type]?.({ target: this }); }
  };
}

function setupLog(options = {}) {
  const elements = Object.fromEntries(["toggleButton", "count", "controls", "levelFilter", "phaseFilter", "autoScroll",
    "copyButton", "exportButton", "clearButton", "list"].map((key) => [key, control()]));
  elements.list.hidden = true;
  const statuses = [];
  const controller = createProcessLogController({ elements, setStatus: (message) => statuses.push(message),
    copyText: async () => {}, downloadText() {}, ...options });
  return { elements, statuses, controller };
}

function eventTarget() {
  const listeners = new Map();
  return { listeners,
    addEventListener(type, callback, capture) { listeners.set(type, { callback, capture }); },
    removeEventListener(type, callback, capture) {
      assert.deepEqual(listeners.get(type), { callback, capture });
      listeners.delete(type);
    },
    fire(type, event) { listeners.get(type)?.callback(event); }
  };
}

test("global exceptions and arbitrary rejections reach the real log with diagnostics and native reporting intact", () => {
  const windowTarget = eventTarget();
  const { elements, controller } = setupLog({ windowTarget });
  const error = new Error("global failure");
  error.diagnostic = { phase: "p3", invariant: "valid-order" };
  const event = { error, target: windowTarget, filename: "http://localhost/main.js?token=hidden", lineno: 8, colno: 2,
    preventDefault() { assert.fail("must not suppress native errors"); } };
  windowTarget.fire("error", event);
  const saved = controller.model.entries()[0];
  assert.equal(saved.phase, "runtime");
  assert.equal(saved.details.error.stack, error.stack);
  assert.equal(saved.details.line, 8);
  assert.equal(saved.details.fileName, "http://localhost/main.js");
  assert.equal(elements.list.hidden, false);
  assert.match(elements.list.innerHTML, /global failure/);
  windowTarget.fire("unhandledrejection", { reason: error });
  assert.equal(controller.model.size, 1, "already reported error objects must not be logged again by global handlers");
  for (const reason of ["plain reason", null, 7, { message: "object reason", diagnostic: { phase: "p0" } }]) {
    windowTarget.fire("unhandledrejection", { reason });
  }
  assert.equal(controller.model.size, 5);
  windowTarget.fire("unhandledrejection", { reason: Object.assign(new Error("cancelled"), { name: "AbortError" }) });
  assert.equal(controller.model.size, 5);
  elements.phaseFilter.value = "runtime";
  controller.render();
  assert.match(elements.list.innerHTML, /object reason/);
  controller.dispose();
  assert.equal(windowTarget.listeners.size, 0);
});

test("resource failures are captured and a failing logger does not recurse", () => {
  const windowTarget = eventTarget();
  const { controller, elements } = setupLog({ windowTarget });
  assert.equal(windowTarget.listeners.get("error").capture, true);
  windowTarget.fire("error", { target: { tagName: "SCRIPT", src: "http://localhost/missing.js?token=private" } });
  assert.match(controller.model.toJsonLines(), /Resource load failed/);
  assert.doesNotMatch(controller.model.toJsonLines(), /private/);
  Object.defineProperty(elements.list, "innerHTML", { set() {
    windowTarget.fire("unhandledrejection", { reason: new Error("recursive") });
    throw new Error("broken DOM");
  } });
  assert.doesNotThrow(() => windowTarget.fire("unhandledrejection", { reason: new Error("original") }));
  assert.equal(controller.model.size, 2);
  assert.doesNotMatch(controller.model.toJsonLines(), /recursive/);
});

test("global deduplication expires when the original log entry is evicted or cleared", () => {
  const windowTarget = eventTarget();
  const { controller } = setupLog({ windowTarget, capacity: 2 });
  const error = new Error("recurring failure");
  controller.append("error", "import", error.message, { error });
  windowTarget.fire("unhandledrejection", { reason: error });
  assert.equal(controller.model.size, 1, "a retained local error suppresses its global duplicate");
  controller.append("info", "render", "first progress");
  controller.append("info", "render", "second progress");
  windowTarget.fire("unhandledrejection", { reason: error });
  assert.equal(controller.model.entries({ level: "error" }).length, 1, "recurrence must be visible after eviction");
  controller.model.clear();
  windowTarget.fire("unhandledrejection", { reason: error });
  assert.equal(controller.model.entries({ level: "error" }).length, 1);
});

test("copy and export failures are recorded with stacks and persistence filtering works", async () => {
  const error = new Error("download blocked");
  const { controller, elements } = setupLog({ copyText: async () => { throw error; }, downloadText() { throw error; } });
  await controller.copy();
  controller.export();
  assert.equal(controller.model.entries({ phase: "export", level: "error" }).length, 2);
  assert.equal(controller.model.entries()[0].details.error.stack, error.stack);
  controller.append("error", "persistence", "save failed", { operation: "save-session" });
  elements.phaseFilter.value = "persistence";
  controller.render();
  assert.match(elements.list.innerHTML, /save failed/);
  assert.doesNotMatch(elements.list.innerHTML, /download blocked/);
});

test("process log controller owns filtering, disclosure and export interactions", async () => {
  const elements = {
    toggleButton: control(), count: control(), controls: control(), levelFilter: control(""),
    phaseFilter: control(""), autoScroll: control(), copyButton: control(), exportButton: control(),
    clearButton: control(), list: control()
  };
  elements.list.hidden = true;
  const statuses = [];
  const copied = [];
  const downloads = [];
  const controller = createProcessLogController({
    elements,
    setStatus: (message) => statuses.push(message),
    copyText: async (text) => copied.push(text),
    downloadText: (...args) => downloads.push(args)
  });
  controller.append("info", "layout", "started");
  assert.equal(elements.count.textContent, "1");
  elements.toggleButton.fire("click");
  assert.equal(elements.list.hidden, false);
  assert.match(elements.list.innerHTML, /started/);
  await elements.copyButton.fire("click");
  assert.match(copied[0], /started/);
  elements.exportButton.fire("click");
  assert.equal(downloads[0][1], "netlist-process-log.jsonl");
  controller.append("error", "layout", "failed");
  assert.equal(elements.toggleButton.attributes["aria-expanded"], "true");
  elements.clearButton.fire("click");
  assert.equal(controller.model.size, 0);
  assert.equal(statuses.at(-1), "Process Log cleared");
});

test("process log controller contains download failures at its port boundary", () => {
  const elements = {
    toggleButton: control(), count: control(), controls: control(), levelFilter: control(""),
    phaseFilter: control(""), autoScroll: control(), copyButton: control(), exportButton: control(),
    clearButton: control(), list: control()
  };
  const statuses = [];
  const controller = createProcessLogController({
    elements,
    setStatus: (message) => statuses.push(message),
    copyText: async () => {},
    downloadText: () => { throw new Error("blocked"); }
  });
  controller.append("info", "export", "ready");
  controller.export();
  assert.match(statuses.at(-1), /Export log failed: blocked/);
});
