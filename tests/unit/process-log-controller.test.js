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
