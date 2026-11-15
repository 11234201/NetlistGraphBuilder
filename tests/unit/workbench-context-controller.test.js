import assert from "node:assert/strict";
import test from "node:test";
import { createWorkbenchContextController } from "../../src/ui/workbench_context_controller.js";

test("unavailable diagnostics preserve disclosure state while the shared log changes", () => {
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) {
      const element = new EventTarget();
      Object.assign(element, { hidden: false, textContent: "", children: [], selectedOptions: [],
        contains: () => false, querySelector: () => null, classList: { contains: () => false },
        setAttribute(name, value) { this[name] = value; } });
      elements.set(id, element);
    }
    return elements.get(id);
  };
  const document = Object.assign(new EventTarget(), { getElementById: get, querySelectorAll: () => [] });
  let notify, nextFrame;
  const windowTarget = {
    requestAnimationFrame(callback) { nextFrame = callback; return 1; }, cancelAnimationFrame() {},
    MutationObserver: class { constructor(callback) { notify = callback; } observe() {} disconnect() {} }
  };
  get("processLogList").hidden = true;
  get("diagnosticsList").textContent = "No diagnostics";
  const controller = createWorkbenchContextController({ document, windowTarget, readContext: () => ({}), closeLog() {} });
  const button = get("toggleDiagnosticsButton"), drawer = get("diagnosticsDrawer");
  drawer.hidden = true;
  button.dispatchEvent(new Event("click"));
  assert.equal(drawer.hidden, false);
  assert.equal(button["aria-expanded"], "true");

  // The active domain saves the Netlist disclosure, then hides its capability.
  button.hidden = true;
  drawer.hidden = true;
  get("processLogList").hidden = false;
  notify(); nextFrame();
  assert.equal(drawer.hidden, true);
  assert.equal(button["aria-expanded"], "true", "the disabled capability must retain its saved disclosure state");
  get("processLogList").hidden = true;
  notify(); nextFrame();
  button.hidden = false;
  drawer.hidden = false;
  assert.equal(button["aria-expanded"], "true");

  // Normal Netlist log/diagnostics mutual exclusion remains active.
  get("processLogList").hidden = false;
  notify(); nextFrame();
  assert.equal(drawer.hidden, true);
  assert.equal(button["aria-expanded"], "false");
  controller.dispose();
});
