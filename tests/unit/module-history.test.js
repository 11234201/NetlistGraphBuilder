import assert from "node:assert/strict";
import test from "node:test";
import {
  canStepModuleHistory,
  createModuleHistory,
  createModuleHistoryEntry,
  pushModuleHistory,
  replaceCurrentModuleHistory,
  stepModuleHistory
} from "../../src/app/moduleHistory.js";

function entry(moduleName, overrides = {}) {
  return {
    moduleName,
    viewMode: "whole",
    coneRootNodeId: null,
    coneDepth: 3,
    faninDepth: 3,
    fanoutDepth: 3,
    selectedNodeId: null,
    selectedNet: null,
    transform: { x: 0, y: 0, scale: 1 },
    ...overrides
  };
}

test("module history supports back, forward and branch replacement", () => {
  let history = createModuleHistory();
  history = pushModuleHistory(history, entry("top"));
  history = pushModuleHistory(history, entry("mid"));
  history = pushModuleHistory(history, entry("leaf"));
  let result = stepModuleHistory(history, -1, ["top", "mid", "leaf"]);
  assert.equal(result.entry.moduleName, "mid");
  assert.equal(canStepModuleHistory(result.history, 1), true);
  history = pushModuleHistory(result.history, entry("other"));
  assert.deepEqual(history.entries.map((item) => item.moduleName), ["top", "mid", "other"]);
  assert.equal(canStepModuleHistory(history, 1), false);
});

test("module history snapshots and restores view, selection and viewport values", () => {
  const state = {
    currentModule: { name: "leaf" },
    viewMode: "focused",
    coneRootNodeId: "cell:u0",
    coneDepth: 5,
    faninDepth: 2,
    fanoutDepth: 4,
    selectedNodeId: "cell:u0",
    selectedNet: null,
    transform: { x: 12, y: -8, scale: 2.5 }
  };
  const snapshot = createModuleHistoryEntry(state);
  let history = pushModuleHistory(createModuleHistory(), snapshot);
  state.transform.x = 99;
  history = replaceCurrentModuleHistory(history, { ...snapshot, selectedNet: "n1" });
  assert.deepEqual(history.entries[0].transform, { x: 12, y: -8, scale: 2.5 });
  assert.equal(history.entries[0].viewMode, "focused");
  assert.equal(history.entries[0].selectedNet, "n1");
});

test("module history safely skips entries whose modules disappeared", () => {
  let history = createModuleHistory();
  history = pushModuleHistory(history, entry("top"));
  history = pushModuleHistory(history, entry("deleted"));
  history = pushModuleHistory(history, entry("leaf"));
  const result = stepModuleHistory(history, -1, ["top", "leaf"]);
  assert.equal(result.entry.moduleName, "top");
  assert.equal(result.history.index, 0);
});
