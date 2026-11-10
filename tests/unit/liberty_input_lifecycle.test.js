import assert from "node:assert/strict";
import test from "node:test";
import { createQuickInputController } from "../../src/ui/quick_input_controller.js";
import { createLibertyController } from "../../src/ui/liberty_controller.js";
import { createQuickInputElements } from "../../src/ui/workbench_elements.js";
import { createLibertyLibraryService } from "../../src/domains/netlist/liberty_import.js";
import { runCooperativeTask } from "../../src/application/cooperative_task.js";

function target() {
  const listeners = new Map();
  return {
    value: "", focus() {}, setSelectionRange() {},
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    async emit(type, event = {}) {
      await Promise.all((listeners.get(type) || []).map((listener) => listener(event)));
    }
  };
}

async function setup({ execute = runCooperativeTask, refresh = async () => {} } = {}) {
  const service = createLibertyLibraryService({ execute });
  await service.importText("library(old){}", { name: "old.lib" });
  const elements = {
    libertyInput: target(), cancelLibertyButton: target(), clearLibertyButton: target(),
    netlistTextInput: target(), netlistTextForm: target(), netlistTextDialog: { open: false }
  };
  const statuses = [], summary = {}, loadedDesigns = [];
  const library = createLibertyController({ elements: {
    summary, diagnostics: {}, cancelButton: elements.cancelLibertyButton, clearButton: elements.clearLibertyButton
  }, read: service.read, importText: service.importText, clear: service.clear, cancel: service.cancel,
  refresh, setStatus: (status) => statuses.push(status) });
  const quick = createQuickInputController({ elements: createQuickInputElements(elements, {}), windowTarget: target(),
    loadText: (text, options) => options.kind === "liberty" ? library.load(text, options) : loadedDesigns.push(text),
    setStatus: (status) => statuses.push(status) });
  return { service, elements, quick, statuses, summary, loadedDesigns };
}

function deferred() {
  let resolve;
  const promise = new Promise((finish) => { resolve = finish; });
  return { promise, resolve };
}

const ambiguousLibraries = () => ["fast", "slow"].map((name) => ({
  name: `${name}.lib`, text: async () => `library(${name}){}`
}));

test("an older import cancellation cannot overwrite the latest batch rejection", async () => {
  const entered = deferred(), release = deferred();
  let pause = false;
  const { service, quick, statuses } = await setup({ execute: (steps, options) => runCooperativeTask(steps, {
    ...options, yieldControl: async () => { if (pause) { entered.resolve(); await release.promise; } }
  }) });
  const original = service.read();
  pause = true;
  const pending = quick.loadFiles([{ name: "pending.lib", text: async () => "library(pending){}" }]);
  await entered.promise;
  await quick.loadFiles(ambiguousLibraries());
  const rejected = statuses.at(-1);
  assert.match(rejected, /one Liberty file per batch/i);
  release.resolve();
  await pending;
  assert.equal(service.read(), original);
  assert.equal(statuses.at(-1), rejected);
});

test("an older refresh completion cannot overwrite the latest batch rejection", async () => {
  const entered = deferred(), release = deferred();
  const { service, quick, statuses } = await setup({ refresh: async () => {
    entered.resolve(); await release.promise;
  } });
  const pending = quick.loadFiles([{ name: "prepared.lib", text: async () => "library(prepared){}" }]);
  await entered.promise;
  const committed = service.read();
  await quick.loadFiles(ambiguousLibraries());
  const rejected = statuses.at(-1);
  assert.match(rejected, /one Liberty file per batch/i);
  release.resolve();
  await pending;
  assert.equal(service.read(), committed);
  assert.equal(statuses.at(-1), rejected);
});

test("a batch with multiple Liberty files is rejected before mutating library or design, in either order", async () => {
  for (const reversed of [false, true]) {
    const { service, quick, statuses, loadedDesigns } = await setup();
    const original = service.read();
    let fullReads = 0;
    const libraries = ["slow", "fast"].map((corner) => ({ name: `${corner}.lib`, async text() {
      fullReads += 1;
      return `library(${corner}){cell(C){pin(A){direction:input;}pin(Z){direction:output;function:${corner === "slow" ? '"!A"' : 'A'};}}}`;
    } }));
    if (reversed) libraries.reverse();
    await quick.loadFiles([{ name: "new.v", text: async () => "module new; endmodule" }, ...libraries]);
    assert.equal(service.read(), original);
    assert.deepEqual(loadedDesigns, []);
    assert.equal(fullReads, 0);
    assert.match(statuses.at(-1), /one Liberty file per batch/i);
    await quick.loadFiles([libraries[0]]);
    assert.equal(service.read().sourceName, libraries[0].name);
  }
});

test("multiple content-detected Liberty files cannot silently replace one another", async () => {
  const { service, quick, statuses } = await setup();
  const original = service.read();
  await quick.loadFiles(["first", "second"].map((name) => ({ name: `${name}.txt`,
    slice: () => ({ text: async () => `library(${name}){}` }),
    text: async () => { throw new Error("Ambiguous batch must not read complete libraries"); }
  })));
  assert.equal(service.read(), original);
  assert.match(statuses.at(-1), /one Liberty file per batch/i);
});

test("a cancelled batch cannot publish a late multiple-library error", async () => {
  const { service, quick, elements, statuses } = await setup();
  let finishRead, markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const pending = quick.loadFiles([
    { name: "first.lib", text: async () => "library(first){}" },
    { name: "second.txt", slice: () => ({ text: () => new Promise((resolve) => {
      finishRead = resolve; markStarted();
    }) }) }
  ]);
  await started;
  await elements.clearLibertyButton.emit("click");
  const unloaded = statuses.at(-1);
  finishRead("library(second){}");
  await pending;
  assert.equal(service.read(), null);
  assert.equal(statuses.at(-1), unloaded);
});

for (const input of ["file", "drop", "prefix"]) {
  for (const action of ["unload", "cancel"]) {
    test(`${action} invalidates a pending Liberty ${input} read and allows the next import`, async () => {
      const { service, elements, quick, statuses, summary } = await setup();
      const original = service.read();
      let finishRead;
      const file = { name: input === "prefix" ? "stale.txt" : "stale.lib",
        text: () => new Promise((resolve) => { finishRead = resolve; }) };
      const pending = input === "file"
        ? elements.libertyInput.emit("change", { target: { files: [file], value: file.name } })
        : quick.loadFiles([file]);
      assert.equal(typeof finishRead, "function");
      await elements[action === "unload" ? "clearLibertyButton" : "cancelLibertyButton"].emit("click");
      const status = statuses.at(-1);
      finishRead("library(stale){}");
      await pending;
      assert.equal(service.read(), action === "unload" ? null : original);
      assert.equal(statuses.at(-1), status);
      assert.doesNotMatch(summary.textContent, /stale/);
      await quick.loadFiles([{ name: "fresh.lib", text: async () => "library(fresh){}" }]);
      assert.equal(service.read().sourceName, "fresh.lib");
    });
  }
}
