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
    netlistInput: makeTarget(), timingInput: makeTarget(), goldenInput: makeTarget(), libertyInput: makeTarget(),
    pasteNetlistButton: makeTarget(), pasteTimingButton: makeTarget(),
    closeTextButton: makeTarget(), cancelTextButton: makeTarget(),
    textForm: { ...makeTarget(), requestSubmit() {} },
    textInput: makeTarget(), textTitle: {}, textDescription: {},
    textDialog: { open: false, showModal() { this.open = true; }, close() { this.open = false; } },
    dropOverlay: { setAttribute() {} },
    body: { classList: { add() {}, remove() {} } }
  };
}

test("Liberty files load before designs, oversize files are rejected before reading, paste shares import", async () => {
  const loaded = [], statuses = [], windowTarget = eventTarget();
  const elements = inputElements();
  const controller = createQuickInputController({ elements, windowTarget,
    loadText: (text, options) => loaded.push({ text, ...options }), setStatus: (value) => statuses.push(value) });
  await controller.loadFiles([
    { name: "design.v", text: async () => "module top; endmodule" },
    { name: "demo.lib", text: async () => "library(demo){}" }
  ]);
  assert.deepEqual(loaded.map((item) => item.kind), ["liberty", "netlist"]);
  assert.ok(loaded[0].signal instanceof AbortSignal);
  await controller.loadFiles([{ name: "huge.lib", size: 65 * 1024 * 1024, text: () => { throw new Error("should not read"); } }]);
  assert.match(statuses.at(-1), /maxBytes/);
  let prevented = false;
  await windowTarget.listeners.paste({ clipboardData: { getData: () => "/* comment */library(pasted){}" },
    preventDefault: () => { prevented = true; } });
  assert.ok(prevented);
  assert.equal(loaded.at(-1).kind, "liberty");
  assert.equal(loaded.at(-1).label, "pasted Liberty");
});

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

test("mixed dropped files classify timing JSON before sorting dependencies", async () => {
  const loaded = [], statuses = [];
  const controller = createQuickInputController({ elements: inputElements(), windowTarget: eventTarget(),
    loadText: (text, options) => loaded.push([options.kind, text]), setStatus: (message) => statuses.push(message) });
  const timing = JSON.stringify({ points: { "u/Y": [1, 2, 1] } });
  await controller.loadFiles([
    { name: "view.json", text: async () => '{"kind":"netlist-layout-golden"}' },
    { name: "timing.JSON", text: async () => timing },
    { name: "design.v", text: async () => "module top; endmodule" },
    { name: "cells.lib", text: async () => "library(cells){}" }
  ]);
  assert.deepEqual(loaded.map(([kind]) => kind), ["liberty", "netlist", "timing", "golden"]);
  assert.equal(loaded[2][1], timing);
  assert.deepEqual(statuses, []);
});

test("JSON file classification reads past the sniffing prefix for known and unknown extensions", async () => {
  const loaded = [], statuses = [];
  const controller = createQuickInputController({ elements: inputElements(), windowTarget: eventTarget(),
    loadText: (text, options) => loaded.push([options.kind, text]), setStatus: (message) => statuses.push(message) });
  const timing = JSON.stringify({ metadata: "x".repeat(70000), modules: { top: { points: { "u/Y": [1, 2, 1] } } } });
  for (const [name, source] of [["timing.json", timing], ["timing.data", timing], ["whitespace.json", " ".repeat(70000) + timing]]) {
    // Blob.slice/text exercise the same prefix/full-text boundary as browser Files.
    const file = new Blob([source]);
    file.name = name;
    await controller.loadFiles([file]);
    assert.deepEqual(loaded.at(-1), ["timing", source]);
  }
  assert.equal(loaded.length, 3);
  assert.deepEqual(statuses, []);
});

test("invalid JSON is reported during classification without preventing a valid design load", async () => {
  const loaded = [], statuses = [];
  const controller = createQuickInputController({ elements: inputElements(), windowTarget: eventTarget(),
    loadText: (text, options) => loaded.push(options.kind), setStatus: (message) => statuses.push(message) });
  await controller.loadFiles([
    { name: "broken.json", text: async () => '{"points": {}' },
    { name: "design.v", text: async () => "module top; endmodule" }
  ]);
  assert.deepEqual(loaded, ["netlist"]);
  assert.match(statuses[0], /Load failed broken\.json:/);
});

test("a newer batch cancels a pending complete JSON classification read", async () => {
  const loaded = [], statuses = [];
  let releaseRead;
  let startedRead;
  const readStarted = new Promise((resolve) => { startedRead = resolve; });
  const controller = createQuickInputController({ elements: inputElements(), windowTarget: eventTarget(),
    loadText: (text, options) => loaded.push(options.label), setStatus: (message) => statuses.push(message) });
  const oldLoad = controller.loadFiles([{
    name: "old.json",
    slice: () => ({ text: async () => '{"points":' }),
    text: () => { startedRead(); return new Promise((resolve) => { releaseRead = resolve; }); }
  }]);
  await readStarted;
  await controller.loadFiles([{ name: "new.v", text: async () => "module newer; endmodule" }]);
  releaseRead('{"points":{}}');
  await oldLoad;
  assert.deepEqual(loaded, ["new.v"]);
  assert.deepEqual(statuses, []);
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

test("unknown-extension files use a prefix only for classification and import the complete text", async () => {
  const prefix = "module top;\n" + "wire a;\n".repeat(9000);
  const complete = `${prefix}endmodule`;
  let loaded;
  const file = {
    name: "design.unknown", text: async () => complete,
    slice: () => ({ text: async () => prefix.slice(0, 65536) })
  };
  const controller = createQuickInputController({ elements: inputElements(), windowTarget: eventTarget(),
    loadText: (text) => { loaded = text; }, setStatus() {}, schedule: (task) => task() });
  await controller.loadFiles([file]);
  assert.equal(loaded, complete);
});

test("batch loading continues to a later valid netlist before applying dependent inputs", async () => {
  const loaded = [], statuses = [];
  const controller = createQuickInputController({ elements: inputElements(), windowTarget: eventTarget(),
    loadText: async (text) => { if (text === "bad") throw new Error("invalid"); loaded.push(text); },
    setStatus: (message) => statuses.push(message), schedule: (task) => task() });
  await controller.loadFiles([
    { name: "bad.v", text: async () => "bad" },
    { name: "good.v", text: async () => "module good; endmodule" },
    { name: "good.log", text: async () => "inst <u>" }
  ]);
  assert.deepEqual(loaded, ["module good; endmodule", "inst <u>"]);
  assert.match(statuses[0], /bad\.v: invalid/);
});

test("batch loading keeps a successful design available after a later netlist fails", async () => {
  const loaded = [], statuses = [];
  const controller = createQuickInputController({ elements: inputElements(), windowTarget: eventTarget(),
    loadText: async (text) => { if (text === "bad") throw new Error("invalid"); loaded.push(text); },
    setStatus: (message) => statuses.push(message), schedule: (task) => task() });
  await controller.loadFiles([
    { name: "good.v", text: async () => "module good; endmodule" },
    { name: "bad.v", text: async () => "bad" },
    { name: "good.log", text: async () => "inst <u>" }
  ]);
  assert.deepEqual(loaded, ["module good; endmodule", "inst <u>"]);
  assert.match(statuses[0], /bad\.v: invalid/);
  assert.equal(statuses.some((message) => message.startsWith("Skipped")), false);
});

test("batch loading skips timing and Golden when every netlist failed", async () => {
  const loaded = [], statuses = [];
  const controller = createQuickInputController({ elements: inputElements(), windowTarget: eventTarget(),
    loadText: async (text) => { if (text === "bad") throw new Error("invalid"); loaded.push(text); },
    setStatus: (message) => statuses.push(message), schedule: (task) => task() });
  await controller.loadFiles([
    { name: "bad.v", text: async () => "bad" },
    { name: "timing.log", text: async () => "inst <u>" },
    { name: "view.json", text: async () => "{}" }
  ]);
  assert.deepEqual(loaded, []);
  assert.equal(statuses.filter((message) => message.startsWith("Skipped")).length, 2);
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

test("an obsolete dialog submission cannot close a newly opened dialog", async () => {
  const elements = inputElements();
  let finish;
  createQuickInputController({ elements, windowTarget: eventTarget(),
    loadText: () => new Promise((resolve) => { finish = resolve; }), setStatus() {}, schedule: (task) => task() });
  elements.textDialog.open = true;
  elements.textInput.value = "module old; endmodule";
  const pending = elements.textForm.listeners.submit({ preventDefault() {} });
  elements.closeTextButton.listeners.click();
  elements.pasteNetlistButton.listeners.click();
  finish();
  await pending;
  assert.equal(elements.textDialog.open, true);
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
