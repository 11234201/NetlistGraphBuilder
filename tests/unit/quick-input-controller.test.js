import assert from "node:assert/strict";
import test from "node:test";
import { createQuickInputController as createController, isEditableInputTarget } from "../../src/ui/quick_input_controller.js";
import { createProcessLog } from "../../src/app/processLog.js";
import { createImportRequests } from "../../src/application/import_requests.js";
import { getQuickInputPriority } from "../../src/app/quickInput.js";
import { importAigSource } from "../../src/domains/aig/aig_import.js";

function createQuickInputController(options) {
  return createController({ importRequests: createImportRequests(), ...options });
}

function eventTarget() {
  const listeners = {};
  return {
    listeners,
    addEventListener(type, handler) { listeners[type] = handler; }
  };
}

function inputElements() {
  const makeTarget = () => ({ ...eventTarget(), value: "", focus() {}, setSelectionRange() {} });
  const controls = Object.fromEntries(["text-submit", "text-status", "aig-input-options", "aig-input-view", "bulk-text-expand", "bulk-text-clear"]
    .map((name) => [`[data-${name}]`, { ...makeTarget(), hidden: true, disabled: false }]));
  controls["[data-aig-input-view]"].value = "abc";
  return {
    netlistInput: makeTarget(), timingInput: makeTarget(), goldenInput: makeTarget(), libertyInput: makeTarget(),
    pasteNetlistButton: makeTarget(), pasteTimingButton: makeTarget(), pasteAigButton: makeTarget(),
    closeTextButton: makeTarget(), cancelTextButton: makeTarget(),
    textForm: { ...makeTarget(), requestSubmit() {}, querySelector: (selector) => controls[selector] },
    textInput: makeTarget(), textTitle: {}, textDescription: {},
    textDialog: { ...eventTarget(), open: false, showModal() { this.open = true; }, close() { this.open = false; } },
    dropOverlay: { setAttribute() {} },
    body: { classList: { add() {}, remove() {} } }
  };
}

test("AIG file, drop, direct paste and dialog share the cancellable input request", async () => {
  const elements = inputElements(), windowTarget = eventTarget(), loaded = [];
  const controller = createQuickInputController({ elements, windowTarget, setStatus() {}, schedule: (run) => run(),
    loadText: async (text, options) => { loaded.push({ text, ...options }); } });
  const text = '.model m\n.inputs a\n.outputs a\n.end';
  await elements.netlistInput.listeners.change({ target: { files: [{ name: 'sample.BLIF', text: async () => text }] } });
  await controller.loadFiles([{ name: 'sample.txt', text: async () => text }]);
  await windowTarget.listeners.paste({ clipboardData: { getData: () => text }, preventDefault() {} });
  elements.pasteAigButton.listeners.click();
  assert.equal(elements.textTitle.textContent, 'Paste AIG');
  elements.textInput.value = text;
  await elements.textForm.listeners.submit({ preventDefault() {} });
  assert.equal(elements.textDialog.open, false);
  assert.equal(loaded.length, 4);
  assert.ok(loaded.every((entry) => entry.kind === 'aig' && entry.text === text && entry.request));
  assert.ok(loaded.slice(0, -1).every((entry) => !entry.request.isCurrent()));
  assert.equal(loaded.at(-1).request.isCurrent(), true);
});

test("file read, detection, batch and paste failures log context and preserve cancellation/stale guards", async () => {
  const elements = inputElements(), windowTarget = eventTarget(), log = createProcessLog();
  const failure = new Error("read or import failed");
  const controller = createQuickInputController({ elements, windowTarget, setStatus() {},
    loadText: async () => { throw failure; }, schedule: (task) => task(),
    logProcess: (level, phase, message, details) => log.append({ level, phase, message, details }) });
  const file = { name: "broken.v", text: async () => { throw failure; } };
  await elements.netlistInput.listeners.change({ target: { files: [file] } });
  assert.equal(log.entries().at(-1).details.fileName, "broken.v");
  assert.equal(log.entries().at(-1).details.error.stack, failure.stack);
  await controller.loadFiles([{ name: "unknown.bin", text: async () => "unrecognized" }]);
  assert.equal(log.entries().at(-1).details.operation, "classify-file");
  await controller.loadFiles([{ name: "batch.v", text: async () => "module top; endmodule" }]);
  assert.equal(log.entries().at(-1).details.operation, "import-batch");
  await windowTarget.listeners.paste({ clipboardData: { getData: () => "module top; endmodule" }, preventDefault() {} });
  assert.equal(log.entries().at(-1).details.operation, "paste-text");
  const count = log.size;
  const cancellation = Object.assign(new Error("cancelled"), { name: "AbortError" });
  await elements.netlistInput.listeners.change({ target: { files: [{ name: "cancel.v", text: async () => { throw cancellation; } }] } });
  assert.equal(log.size, count);
  let rejectOld;
  const old = elements.netlistInput.listeners.change({ target: { files: [{ name: "old.v", text: () => new Promise((_, reject) => { rejectOld = reject; }) }] } });
  await elements.netlistInput.listeners.change({ target: { files: [file] } });
  const currentCount = log.size;
  rejectOld(failure);
  await old;
  assert.equal(log.size, currentCount);
});

test("a dropped text BLIF is recognized beyond a large mapping header or leading whitespace", async () => {
  const imports = [], failures = [];
  const controller = createQuickInputController({ elements: inputElements(), windowTarget: eventTarget(),
    loadText: (text, options) => imports.push([options.kind, text]), setStatus: (text) => failures.push(text) });
  // The first sample ends inside .model or before the first nonblank line.
  const sources = ["# n0 " + "x".repeat(65528), "\n".repeat(65536)].map((prefix) =>
    prefix + "\n.model top\n.inputs n0\n.outputs n0\n.end");
  for (const source of sources) {
    const file = new Blob([source]);
    file.name = "mapped.txt";
    await controller.loadFiles([file]);
  }
  assert.deepEqual(failures, []);
  assert.deepEqual(imports, sources.map((source) => ["aig", source]));
});

test("pasted BLIF diagnostics retain the line numbers in the editable source", async () => {
  const elements = inputElements(), log = createProcessLog();
  createQuickInputController({ elements, windowTarget: eventTarget(), setStatus() {}, schedule: (fn) => fn(),
    loadText: (text) => importAigSource(text),
    logProcess: (level, phase, message, details) => log.append({ level, phase, message, details }) });
  elements.pasteAigButton.listeners.click();
  elements.textInput.value = "\n\n# a name\n.model m\n.inputs a\n.outputs y\n.names a y\nx 1\n.end";
  await elements.textForm.listeners.submit({ preventDefault() {} });
  const failure = JSON.parse(log.toJsonLines());
  assert.equal(failure.details.error.diagnostic.line, 8);
  assert.equal(failure.details.error.diagnostic.code, "blif.cover-value");
  assert.equal(elements.textDialog.open, true);
});

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

test("an external domain import invalidates pending picker, drop and clipboard-file reads", async () => {
  for (const ingress of ["picker", "drop", "clipboard"]) {
    const elements = inputElements(), windowTarget = eventTarget(), importRequests = createImportRequests();
    const loaded = [], statuses = [];
    const controller = createQuickInputController({ elements, windowTarget, importRequests,
      loadText: (text) => loaded.push(text), setStatus: (message) => statuses.push(message) });
    let release;
    const file = { name: "older.v", text: () => new Promise((resolve) => { release = resolve; }) };
    const pending = ingress === "picker"
      ? elements.netlistInput.listeners.change({ target: { files: [file] } })
      : ingress === "drop" ? controller.loadFiles([file])
        : windowTarget.listeners.paste({ clipboardData: { files: [file] }, preventDefault() {} });
    assert.equal(typeof release, "function", ingress);
    const current = importRequests.begin();
    release("module older; endmodule");
    await pending;
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(loaded, [], `${ingress} cannot replace the newer domain`);
    assert.deepEqual(statuses, []);
    assert.equal(current.isCurrent(), true);
  }
});

test("every document input invalidates an external domain request at intent, before file reading", async () => {
  for (const ingress of ["picker", "drop", "clipboard-files", "clipboard-text", "dialog"]) {
    const elements = inputElements(), windowTarget = eventTarget(), importRequests = createImportRequests();
    const loaded = [];
    const controller = createQuickInputController({ elements, windowTarget, importRequests,
      loadText: (text) => loaded.push(text), setStatus() {}, schedule: (task) => task() });
    const previous = importRequests.begin();
    let release;
    const file = { name: "latest.v", text: () => new Promise((resolve) => { release = resolve; }) };
    const source = "module latest; endmodule";
    let pending;
    if (ingress === "picker") pending = elements.netlistInput.listeners.change({ target: { files: [file] } });
    else if (ingress === "drop") pending = controller.loadFiles([file]);
    else if (ingress === "clipboard-files") pending = windowTarget.listeners.paste({ clipboardData: { files: [file] }, preventDefault() {} });
    else if (ingress === "clipboard-text") pending = windowTarget.listeners.paste({ clipboardData: { getData: () => source }, preventDefault() {} });
    else {
      elements.textInput.value = source;
      pending = elements.textForm.listeners.submit({ preventDefault() {} });
    }
    assert.equal(previous.signal.aborted, true, ingress);
    assert.equal(previous.isCurrent(), false, ingress);
    release?.(source);
    await pending;
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(loaded, [source], ingress);
  }
});

test("replacing an in-flight import suppresses obsolete failures and aborts Liberty work", async () => {
  const elements = inputElements(), importRequests = createImportRequests();
  const statuses = [];
  let rejectLoad, librarySignal;
  createQuickInputController({ elements, windowTarget: eventTarget(), importRequests,
    loadText: (_text, options) => {
      librarySignal = options.signal;
      return new Promise((_, reject) => { rejectLoad = reject; });
    }, setStatus: (message) => statuses.push(message) });
  const pending = elements.libertyInput.listeners.change({ target: { files: [{ name: "older.lib", text: async () => "library(old){}" }] } });
  await Promise.resolve();
  importRequests.begin();
  assert.equal(librarySignal.aborted, true);
  rejectLoad(new Error("obsolete import failed"));
  await pending;
  assert.deepEqual(statuses, []);
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

test("a domain transition can prepare the netlist before applying its batch attachments", async () => {
  const loaded = [];
  const controller = createQuickInputController({ elements: inputElements(), windowTarget: eventTarget(),
    getInputPriority: (kind) => kind === "netlist" ? -2 : getQuickInputPriority(kind),
    loadText: (_text, options) => loaded.push(options.kind), setStatus() {} });
  await controller.loadFiles([
    { name: "cells.lib", text: async () => "library(cells){}" },
    { name: "design.v", text: async () => "module top; endmodule" },
    { name: "timing.rpt", text: async () => "point at rt slack\nu/Y 1 2 1" },
    { name: "saved.json", text: async () => "{}" }
  ]);
  assert.deepEqual(loaded, ["netlist", "liberty", "timing", "golden"]);
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

test("paste dialog shows progress and prevents repeated submissions until completion", async () => {
  const elements = inputElements(), calls = [];
  let finish;
  const controller = createQuickInputController({ elements, windowTarget: eventTarget(), setStatus() {}, schedule: (run) => run(),
    loadText: (text, options) => { calls.push({ text, options }); return new Promise((resolve) => { finish = resolve; }); } });
  controller.openDialog("aig");
  elements.textInput.value = ".model m\n.inputs a\n.outputs a\n.end";
  const pending = elements.textForm.listeners.submit({ preventDefault() {} });
  const submit = elements.textForm.querySelector("[data-text-submit]");
  const status = elements.textForm.querySelector("[data-text-status]");
  assert.equal(submit.disabled, true);
  assert.equal(submit.textContent, "Drawing…");
  assert.equal(elements.textInput.disabled, true);
  assert.equal(elements.textForm.querySelector("[data-bulk-text-clear]").disabled, true);
  assert.equal(status.hidden, false);
  assert.match(status.textContent, /正在解析并布局/);
  await elements.textForm.listeners.submit({ preventDefault() {} });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].options.presentationPolicy, { viewStyle: "abc" });
  finish();
  await pending;
  assert.equal(elements.textDialog.open, false);
  assert.equal(submit.disabled, false);
  assert.equal(elements.textInput.disabled, false);
  assert.equal(status.hidden, true);
  assert.equal(calls[0].options.request.signal.aborted, false, "success must not cancel the committed workspace");
});

test("the File Search-first default does not overwrite the last explicit paste choice", () => {
  const elements = inputElements();
  elements.aigSearchFirstInput = { checked: false };
  const controller = createQuickInputController({ elements, windowTarget: eventTarget(), schedule: (run) => run() });
  const view = elements.textForm.querySelector("[data-aig-input-view]");
  controller.openDialog("aig");
  view.value = "standard";
  view.listeners.change();
  controller.closeDialog();
  elements.aigSearchFirstInput.checked = true;
  controller.openDialog("aig");
  assert.equal(view.value, "search-first");
  controller.closeDialog();
  elements.aigSearchFirstInput.checked = false;
  controller.openDialog("aig");
  assert.equal(view.value, "standard");
});

test("an AIG timeout is visible in the dialog and permits Logic View retry with the same source", async () => {
  const elements = inputElements(), policies = [];
  const controller = createQuickInputController({ elements, windowTarget: eventTarget(), setStatus() {}, schedule: (run) => run(),
    loadText: async (text, options) => {
      policies.push(options.presentationPolicy);
      if (policies.length === 1) throw Object.assign(new Error("Graphviz exceeded 20000 ms"), { name: "TimeoutError" });
      assert.equal(text, elements.textInput.value);
    } });
  controller.openDialog("aig");
  elements.textInput.value = ".model m\n.inputs a\n.outputs a\n.end";
  const view = elements.textForm.querySelector("[data-aig-input-view]");
  view.value = "standard";
  await elements.textForm.listeners.submit({ preventDefault() {} });
  const status = elements.textForm.querySelector("[data-text-status]");
  assert.equal(elements.textDialog.open, true);
  assert.equal(view.disabled, false);
  assert.equal(view.value, "standard");
  assert.equal(status.hidden, false);
  assert.match(status.textContent, /Graphviz exceeded 20000 ms.*Logic View/);
  view.value = "abc";
  await elements.textForm.listeners.submit({ preventDefault() {} });
  assert.deepEqual(policies, [{ viewStyle: "standard" }, { viewStyle: "abc" }]);
  assert.equal(elements.textDialog.open, false);
  controller.openDialog("timing");
  assert.equal(elements.textForm.querySelector("[data-aig-input-options]").hidden, true);
});

test("closing a busy paste dialog aborts its request without letting stale results alter a new submission", async () => {
  for (const dismissal of ["cancel-button", "close-button", "escape", "native-close"]) {
    const elements = inputElements(), requests = [], complete = [], statuses = [];
    const controller = createQuickInputController({ elements, windowTarget: eventTarget(), setStatus: (value) => statuses.push(value),
      schedule: (run) => run(), loadText: (_text, { request }) => {
        requests.push(request); return new Promise((resolve, reject) => complete.push({ resolve, reject }));
      } });
    controller.openDialog("aig");
    elements.textInput.value = ".model m\n.inputs a\n.outputs a\n.end";
    const old = elements.textForm.listeners.submit({ preventDefault() {} });
    if (dismissal === "cancel-button") elements.cancelTextButton.listeners.click();
    else if (dismissal === "close-button") elements.closeTextButton.listeners.click();
    else if (dismissal === "escape") elements.textDialog.listeners.cancel({ preventDefault() {} });
    else { elements.textDialog.close(); elements.textDialog.listeners.close(); }
    assert.equal(requests[0].signal.aborted, true, dismissal);
    assert.equal(elements.textDialog.open, false, dismissal);
    assert.equal(elements.textInput.disabled, false, dismissal);
    controller.openDialog("aig");
    const current = elements.textForm.listeners.submit({ preventDefault() {} });
    complete[0].reject(new Error("obsolete failure"));
    await old;
    assert.equal(elements.textDialog.open, true, dismissal);
    assert.equal(elements.textForm.querySelector("[data-text-submit]").disabled, true, dismissal);
    assert.match(elements.textForm.querySelector("[data-text-status]").textContent, /正在解析并布局/);
    assert.ok(!statuses.some((value) => value.includes("obsolete failure")));
    complete[1].resolve();
    await current;
    assert.equal(elements.textDialog.open, false, dismissal);
  }
});

test("a late import error cannot fail the cancelled text command or change the replacement draft", async () => {
  let reject;
  const elements = inputElements(), logs = [];
  const controller = createQuickInputController({elements,windowTarget:eventTarget(),setStatus(){},logProcess:(...row) => logs.push(row),
    schedule:run => run(), loadText:() => new Promise((_, fail) => {reject = fail;})});
  const run = (name,...args) => controller.draftCommand({name,args,opts:{}});
  run("text open","aig");
  run("text set","old source");
  const submitted = run("text submit");
  run("text cancel");
  run("text open","netlist");
  run("text set","new source");
  reject(new Error("obsolete provider failure"));
  await assert.rejects(submitted,{name:"AbortError"});
  assert.equal(elements.textDialog.open,true);
  assert.equal(elements.textInput.value,"new source");
  assert.deepEqual(logs,[]);
});

test("external import cancellation restores paste controls before the stale load settles", async () => {
  const elements = inputElements(), importRequests = createImportRequests();
  let finish;
  const controller = createQuickInputController({ elements, importRequests, windowTarget: eventTarget(), setStatus() {},
    schedule: (run) => run(), loadText: () => new Promise((resolve) => { finish = resolve; }) });
  controller.openDialog("aig");
  elements.textInput.value = "source";
  const pending = elements.textForm.listeners.submit({ preventDefault() {} });
  importRequests.begin();
  assert.equal(elements.textForm.querySelector("[data-text-submit]").disabled, false);
  assert.match(elements.textForm.querySelector("[data-text-status]").textContent, /已取消/);
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
