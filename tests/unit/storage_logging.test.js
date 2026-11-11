import assert from "node:assert/strict";
import test from "node:test";
import { loadSessionStateResult, saveSessionStateResult } from "../../src/persistence/session_storage.js";
import { loadStoredCellConfigResult, saveStoredCellConfig } from "../../src/persistence/cell_config_storage.js";
import { createEmptyCellConfig } from "../../src/infer/cellConfig.js";
import { restoreWorkbenchStorage } from "../../src/app/workbench_storage.js";
import { createProcessLog } from "../../src/app/processLog.js";

function installGlobal(t, name, descriptor) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, ...descriptor });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else delete globalThis[name];
  });
}

test("storage results distinguish empty data, invalid data, and unavailable storage", () => {
  const empty = { getItem: () => null };
  assert.deepEqual(loadSessionStateResult(empty), { ok: true, value: null });
  assert.deepEqual(loadStoredCellConfigResult(empty), { ok: true, value: createEmptyCellConfig() });
  for (const read of [loadSessionStateResult, loadStoredCellConfigResult]) {
    const corrupt = read({ getItem: () => "{" });
    assert.equal(corrupt.ok, false);
    assert.ok(corrupt.error.stack);
    for (const storage of [null, undefined, {}]) {
      const unavailable = read(storage);
      assert.equal(unavailable.ok, false);
      assert.match(unavailable.error.message, /storage is unavailable/);
    }
  }
});

test("storage results preserve the original thrown value, including non-Error exceptions", () => {
  for (const failure of [new Error("quota"), null, "denied"]) {
    const storage = { getItem() { throw failure; }, setItem() { throw failure; } };
    for (const result of [loadSessionStateResult(storage), loadStoredCellConfigResult(storage), saveSessionStateResult({}, storage)]) {
      assert.equal(result.ok, false);
      assert.strictEqual(result.error, failure);
    }
  }
  const result = saveSessionStateResult({ circular: null }, { setItem() {} });
  assert.equal(result.ok, true);
  const circular = {};
  circular.self = circular;
  assert.equal(saveSessionStateResult(circular, { setItem() { assert.fail("encoding must fail first"); } }).ok, false);
});

test("missing Cell Config storage never reports a successful save", () => {
  for (const storage of [null, undefined, {}]) {
    assert.throws(() => saveStoredCellConfig(createEmptyCellConfig(), storage), /storage is unavailable/);
  }
});

test("storage getter failures are returned intact", (t) => {
  const failure = new Error("storage disabled");
  for (const name of ["sessionStorage", "localStorage"]) installGlobal(t, name, { get() { throw failure; } });
  assert.strictEqual(loadSessionStateResult().error, failure);
  assert.strictEqual(saveSessionStateResult({}).error, failure);
  assert.strictEqual(loadStoredCellConfigResult().error, failure);
  assert.throws(() => saveStoredCellConfig(createEmptyCellConfig()), (error) => error === failure);
});

function boot(t, { sessionStorage, localStorage, snapshot = null }) {
  installGlobal(t, "sessionStorage", { value: sessionStorage });
  installGlobal(t, "localStorage", { value: localStorage });
  const log = createProcessLog(), listeners = new Map();
  let cellConfig;
  const restored = restoreWorkbenchStorage({
    windowTarget: { addEventListener: (name, callback) => listeners.set(name, callback) },
    logProcess: (level, phase, message, details) => log.append({ level, phase, message, details }),
    setCellConfig: (value) => { cellConfig = value; },
    getSessionSnapshot: () => typeof snapshot === "function" ? snapshot() : snapshot
  });
  return { log, restored, cellConfig, unload: () => listeners.get("beforeunload")() };
}

test("bootstrap logs corrupt stored data and still starts with safe defaults", (t) => {
  let writes = 0;
  const corrupt = { getItem: () => '{"version":99}', setItem() { writes++; } };
  const { log, restored, cellConfig, unload } = boot(t, { sessionStorage: corrupt, localStorage: corrupt });
  assert.equal(restored, null);
  assert.deepEqual(cellConfig, createEmptyCellConfig());
  const entries = log.entries({ phase: "persistence", level: "error" });
  assert.deepEqual(entries.map((entry) => entry.details.operation), ["load-cell-config", "load-session"]);
  assert.ok(entries.every((entry) => entry.details.error.stack));
  unload();
  assert.equal(writes, 0, "no document means no unload snapshot to save");
  assert.equal(log.size, 2);
});

test("bootstrap restores valid storage without spurious errors and unload saves it", (t) => {
  const saved = [];
  const sessionStorage = { getItem: () => '{"version":2,"source":"module top; endmodule"}', setItem: (...args) => saved.push(args) };
  const { restored, log, unload } = boot(t, { sessionStorage, localStorage: { getItem: () => null }, snapshot: { source: "new text" } });
  assert.equal(restored.source, "module top; endmodule");
  unload();
  assert.equal(JSON.parse(saved[0][1]).source, "new text");
  assert.equal(log.size, 0);
});

for (const failSnapshot of [false, true]) {
  test(`unload failure logs diagnostics without attaching the session; snapshotFailure=${failSnapshot}`, (t) => {
    const failure = new Error("unload failure", { cause: new Error("quota exceeded") });
    const storage = { getItem: () => null, setItem() { throw failure; } };
    const { log, unload } = boot(t, {
      sessionStorage: storage, localStorage: storage,
      snapshot: failSnapshot ? () => { throw failure; } : { source: "must-not-export" }
    });
    unload();
    const [entry] = log.entries({ phase: "persistence", level: "error" });
    assert.equal(log.size, 1);
    assert.equal(entry.details.operation, "save-session-on-unload");
    assert.equal(entry.details.error.stack, failure.stack);
    assert.equal(entry.details.error.cause.message, "quota exceeded");
    assert.doesNotMatch(log.toJsonLines(), /must-not-export/);
  });
}
