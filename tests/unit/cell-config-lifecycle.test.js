import assert from "node:assert/strict";
import test from "node:test";
import { createCellConfigController } from "../../src/app/cell_config_controller.js";
import { createCellConfigUseCases } from "../../src/domains/netlist/cell_config_use_cases.js";
import { createEmptyCellConfig } from "../../src/infer/cellConfig.js";

const config = { kind: "netlist-cell-config", version: 1, cells: { X: { gateKind: "BUF", pins: { A: "input", Z: "output" } } } };

function delayedImport({ current = createEmptyCellConfig() } = {}) {
  let resolve, reject, active = true;
  const read = new Promise((yes, no) => { resolve = yes; reject = no; });
  const saved = [], statuses = [], logs = [];
  const state = { cellConfig: current, compare: { active: true } };
  let refreshes = 0;
  const controller = createCellConfigController({ state,
    elements: { editCellDefinitionButton: {}, exportCellConfigButton: {}, resetCellConfigButton: {} },
    services: { cellConfigUseCases: createCellConfigUseCases({ save: (bundle) => (saved.push(bundle), bundle) }),
      renderCompareGraphs: () => { refreshes += 1; }, setStatus: (message) => statuses.push(message),
      logProcess: (...entry) => logs.push(entry) },
    present: (action) => active ? action() : undefined
  });
  const target = { value: "held.json", files: [{ name: "held.json", text: () => read }] };
  const pending = controller.handleCellConfigImport({ target });
  return { controller, state, saved, statuses, logs, target, pending, resolve, reject,
    hide: () => { active = false; }, refreshes: () => refreshes };
}

test("completed Cell Config imports save global definitions without refreshing an inactive Netlist", async () => {
  const request = delayedImport();
  request.hide(); request.resolve(JSON.stringify(config)); await request.pending;
  assert.equal(request.state.cellConfig.cells.X.gateKind, "BUF");
  assert.equal(request.saved.length, 1);
  assert.equal(request.refreshes(), 0);
  assert.deepEqual(request.statuses, []);
  assert.equal(request.logs[0][0], "info");
  assert.equal(request.target.value, "");
});

test("late Cell Config read failures retain diagnostics without overwriting the active domain status", async () => {
  const request = delayedImport();
  request.hide(); request.reject(new Error("read unavailable")); await request.pending;
  assert.equal(request.saved.length, 0);
  assert.deepEqual(request.statuses, []);
  assert.equal(request.logs[0][0], "error");
  assert.match(request.logs[0][2], /held.json.*read unavailable/);
  assert.equal(request.target.value, "");
});

test("inactive Netlist imports cannot open a conflict dialog or overwrite existing definitions", async () => {
  const request = delayedImport({ current: config });
  request.hide(); request.resolve(JSON.stringify(config)); await request.pending;
  assert.strictEqual(request.state.cellConfig, config);
  assert.equal(request.saved.length, 0);
  assert.deepEqual(request.statuses, []);
  assert.equal(request.logs[0][0], "warning");
  assert.match(request.logs[0][2], /requires confirmation.*not changed/);
});

test("active Netlist imports still save and refresh their view", async () => {
  const request = delayedImport(); request.resolve(JSON.stringify(config)); await request.pending;
  assert.equal(request.saved.length, 1);
  assert.equal(request.refreshes(), 1);
  assert.match(request.statuses[0], /Imported Cell Config held.json/);
});

test("a delayed Cell Config import merges definitions saved while its file was being read", async () => {
  const request = delayedImport();
  const newer = { ...config, cells: { NEW: config.cells.X } };
  const older = { ...config, cells: { OLD: config.cells.X } };
  await request.controller.handleCellConfigImport({ target: { value: "new.json", files: [
    { name: "new.json", text: async () => JSON.stringify(newer) }
  ] } });
  request.resolve(JSON.stringify(older)); await request.pending;
  assert.deepEqual(Object.keys(request.state.cellConfig.cells).sort(), ["NEW", "OLD"]);
  assert.deepEqual(Object.keys(request.saved.at(-1).cells).sort(), ["NEW", "OLD"]);
});

test("a delayed Cell Config import checks conflicts against the latest saved definitions", async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const confirmations = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    confirm: (message) => { confirmations.push(message); return false; }
  } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else delete globalThis.window;
  });
  const request = delayedImport();
  const newer = { ...config, cells: { X: { ...config.cells.X, gateKind: "INV" } } };
  await request.controller.handleCellConfigImport({ target: { value: "new.json", files: [
    { name: "new.json", text: async () => JSON.stringify(newer) }
  ] } });
  request.resolve(JSON.stringify(config)); await request.pending;
  assert.equal(confirmations.length, 1);
  assert.match(confirmations[0], /1 existing Cell Config definition\(s\): X/);
  assert.equal(request.state.cellConfig.cells.X.gateKind, "INV");
  assert.equal(request.saved.length, 1, "declining the newly detected conflict preserves the later save");
});
