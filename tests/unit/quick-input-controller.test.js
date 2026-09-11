import assert from "node:assert/strict";
import test from "node:test";
import { createQuickInputController, isEditableInputTarget } from "../../src/ui/quick_input_controller.js";

function eventTarget() {
  const listeners = {};
  return {
    listeners,
    addEventListener(type, handler) { listeners[type] = handler; }
  };
}

function inputElements() {
  const makeTarget = () => ({ ...eventTarget(), value: "", focus() {} });
  return {
    netlistInput: makeTarget(), timingInput: makeTarget(), goldenInput: makeTarget(),
    pasteNetlistButton: makeTarget(), pasteTimingButton: makeTarget(),
    closeTextButton: makeTarget(), cancelTextButton: makeTarget(),
    textForm: { ...makeTarget(), requestSubmit() {} },
    textInput: makeTarget(), textTitle: {}, textDescription: {},
    textDialog: { open: false, showModal() { this.open = true; }, close() { this.open = false; } },
    dropOverlay: { setAttribute() {} },
    body: { classList: { add() {}, remove() {} } }
  };
}

test("quick input controller orders dropped design, timing and Golden inputs", async () => {
  const loaded = [];
  const controller = createQuickInputController({
    elements: inputElements(), windowTarget: eventTarget(),
    loadText: async (text, options) => {
      loaded.push([`${text}:start`, options.kind]);
      await Promise.resolve();
      loaded.push([`${text}:end`, options.kind]);
    },
    setStatus() {}, schedule: (task) => task()
  });
  await controller.loadFiles([
    { name: "view.json", text: async () => "{}" },
    { name: "timing.log", text: async () => "inst <u1>" },
    { name: "design.v", text: async () => "module top; endmodule" }
  ]);
  assert.deepEqual(loaded.map((entry) => entry[1]), ["netlist", "netlist", "timing", "timing", "golden", "golden"]);
  assert.deepEqual(loaded.map((entry) => entry[0].split(":").at(-1)), ["start", "end", "start", "end", "start", "end"]);
});

test("paste dialog validates empty text and waits for the load before closing", async () => {
  const elements = inputElements();
  const statuses = [];
  const loaded = [];
  const controller = createQuickInputController({
    elements, windowTarget: eventTarget(), loadText: (...args) => loaded.push(args),
    setStatus: (message) => statuses.push(message), schedule: (task) => task()
  });
  controller.openDialog("timing");
  await elements.textForm.listeners.submit({ preventDefault() {} });
  assert.match(statuses[0], /timing text is empty/);
  elements.textInput.value = "inst <u1>";
  await elements.textForm.listeners.submit({ preventDefault() {} });
  assert.equal(loaded[0][1].kind, "timing");
  assert.equal(elements.textDialog.open, false);
});

test("paste dialog stays open and reports asynchronous load failures", async () => {
  const elements = inputElements();
  const statuses = [];
  createQuickInputController({
    elements,
    windowTarget: eventTarget(),
    loadText: async () => { throw new Error("invalid timing"); },
    setStatus: (message) => statuses.push(message),
    schedule: (task) => task()
  });
  elements.textDialog.open = true;
  elements.textInput.value = "inst <u1>";
  await elements.textForm.listeners.submit({ preventDefault() {} });
  assert.equal(elements.textDialog.open, true);
  assert.match(statuses.at(-1), /invalid timing/);
});

test("editable target detection is DOM-constructor independent", () => {
  assert.equal(isEditableInputTarget({ closest: () => ({}) }), true);
  assert.equal(isEditableInputTarget({ closest: () => null }), false);
  assert.equal(isEditableInputTarget(null), false);
});
