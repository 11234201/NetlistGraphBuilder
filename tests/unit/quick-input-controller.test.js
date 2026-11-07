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
  const makeTarget = () => ({ ...eventTarget(), value: "", focus() {}, setSelectionRange() {} });
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

test("file input ignores an older read that finishes after the latest selection", async () => {
  const elements = inputElements();
  const loaded = [];
  let releaseOld;
  createQuickInputController({ elements, windowTarget: eventTarget(),
    loadText: (text) => loaded.push(text), setStatus() {}, schedule: (task) => task() });
  const oldInput = { files: [{ name: "old.v", text: () => new Promise((resolve) => { releaseOld = resolve; }) }], value: "old" };
  const newInput = { files: [{ name: "new.v", text: async () => "module new; endmodule" }], value: "new" };
  const oldLoad = elements.netlistInput.listeners.change({ target: oldInput });
  await Promise.resolve();
  await elements.netlistInput.listeners.change({ target: newInput });
  releaseOld("module old; endmodule");
  await oldLoad;
  assert.deepEqual(loaded, ["module new; endmodule"]);
});

test("batch file loading never reads multiple complete files concurrently", async () => {
  let active = 0;
  let maximum = 0;
  const makeFile = (name, text) => ({ name, async text() {
    active += 1; maximum = Math.max(maximum, active);
    await Promise.resolve();
    active -= 1; return text;
  } });
  const controller = createQuickInputController({ elements: inputElements(), windowTarget: eventTarget(),
    loadText: async () => {}, setStatus() {}, schedule: (task) => task() });
  await controller.loadFiles([
    makeFile("a.v", "module a; endmodule"), makeFile("b.log", "inst <u>"), makeFile("c.json", "{}")
  ]);
  assert.equal(maximum, 1);
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

test("paste dialog submits the original bulk source rather than its visible preview", async () => {
  const elements = inputElements();
  let loaded;
  createQuickInputController({ elements, windowTarget: eventTarget(),
    loadText: (text) => { loaded = text; }, setStatus() {}, schedule: (task) => task() });
  const source = "// comment\n".repeat(30000) + "module last_module; endmodule";
  elements.textInput.listeners.paste({
    clipboardData: { types: ["text/plain"], getData: () => source }, preventDefault() {}
  });
  assert.ok(elements.textInput.value.length < source.length);
  await elements.textForm.listeners.submit({ preventDefault() {} });
  assert.equal(loaded, source);
});
