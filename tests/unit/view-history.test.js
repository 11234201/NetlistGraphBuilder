import assert from "node:assert/strict";
import test from "node:test";
import {
  canStepViewHistory,
  createViewHistory,
  createViewHistoryEntry,
  pushViewHistory,
  stepViewHistory
} from "../../src/app/viewHistory.js";

function state(moduleName, overrides = {}) {
  return {
    currentModule: { name: moduleName },
    viewMode: "whole",
    focusedRootNodeIds: [],
    coneDepth: 3,
    faninDepth: 3,
    fanoutDepth: 3,
    selectedNodeId: null,
    selectedNet: null,
    transform: { x: 0, y: 0, scale: 1 },
    ...overrides
  };
}

test("view history records selection, Focused roots and viewport as one snapshot", () => {
  let history = createViewHistory();
  history = pushViewHistory(history, createViewHistoryEntry(state("top")));
  history = pushViewHistory(history, createViewHistoryEntry(state("top", {
    viewMode: "focused",
    focusedRootNodeIds: ["cell:u1"],
    selectedNodeId: "cell:u1",
    transform: { x: 8, y: -4, scale: 2 }
  })));
  const previous = stepViewHistory(history, -1).entry;
  assert.equal(previous.viewMode, "whole");
  assert.deepEqual(previous.focusedRootNodeIds, []);
  assert.deepEqual(previous.transform, { x: 0, y: 0, scale: 1 });
  assert.equal(canStepViewHistory(history, 1), false);
});

test("view history truncates the forward branch and honors its bound", () => {
  let history = createViewHistory(2);
  for (const name of ["a", "b", "c"]) history = pushViewHistory(history, createViewHistoryEntry(state(name)));
  assert.deepEqual(history.entries.map((entry) => entry.moduleName), ["b", "c"]);
  history = stepViewHistory(history, -1).history;
  history = pushViewHistory(history, createViewHistoryEntry(state("branch")));
  assert.deepEqual(history.entries.map((entry) => entry.moduleName), ["b", "branch"]);
  assert.equal(canStepViewHistory(history, 1), false);
});

test("compare snapshots keep side-specific viewport identity", () => {
  const entry = createViewHistoryEntry(state("top", {
    compare: {
      active: true,
      leftModuleName: "top",
      rightModuleName: "top_Flex",
      selectedName: "u1",
      selectedKind: "cell",
      selectedSide: "right",
      layout: "horizontal",
      outputName: "out",
      wholeRequested: false,
      focusedRootNodeIds: { left: ["cell:l"], right: ["cell:r"] },
      activeFocusedRootNodeId: { left: "cell:l", right: "cell:r" },
      focusedRootsSynchronized: false,
      transforms: { left: { x: 1, y: 2, scale: 1.2 }, right: { x: 3, y: 4, scale: 1.4 } }
    }
  }));
  assert.equal(entry.kind, "compare");
  assert.deepEqual(entry.compare.transforms.right, { x: 3, y: 4, scale: 1.4 });
  assert.equal(entry.compare.layout, "horizontal");
  assert.deepEqual(entry.compare.focusedRootNodeIds, { left: ["cell:l"], right: ["cell:r"] });
  assert.equal(entry.compare.viewModes.left, "focused");
  assert.equal(entry.compare.focusedRootsSynchronized, false);
});

test("compare snapshots keep side-specific layout overrides", () => {
  const entry = createViewHistoryEntry(state("top", {
    compare: {
      active: true,
      leftModuleName: "top",
      rightModuleName: "top_Flex",
      focusedRootNodeIds: { left: [], right: [] },
      activeFocusedRootNodeId: { left: null, right: null },
      transforms: { left: { x: 0, y: 0, scale: 1 }, right: { x: 0, y: 0, scale: 1 } },
      nodePositions: {
        left: new Map([["cell:left", { x: 10, y: 20 }]]),
        right: new Map([["cell:right", { x: 30, y: 40 }]])
      },
      nodeSizes: { left: new Map(), right: new Map() },
      graphOverrides: {
        left: { nodeProperties: {}, cellPinDirections: {} },
        right: { nodeProperties: {}, cellPinDirections: {} }
      }
    }
  }));
  assert.deepEqual(entry.compare.overrides.left.nodePositions, [["cell:left", { x: 10, y: 20 }]]);
  assert.deepEqual(entry.compare.overrides.right.nodePositions, [["cell:right", { x: 30, y: 40 }]]);
});

test("view history snapshots layout overrides without retaining graph or scene objects", () => {
  const entry = createViewHistoryEntry(state("top", {
    nodePositions: new Map([["cell:u1", { x: 10, y: 20 }]]),
    nodeSizes: new Map([["cell:u1", { width: 120, height: 48 }]]),
    graphOverrides: { nodeProperties: { "cell:u1": { label: "adjusted" } }, cellPinDirections: {} }
  }));
  assert.deepEqual(entry.overrides.nodePositions, [["cell:u1", { x: 10, y: 20 }]]);
  assert.equal("graph" in entry, false);
  assert.equal("scene" in entry, false);
});

test("view history preserves occurrence context for hierarchical navigation", () => {
  const entry = createViewHistoryEntry(state("child", {
    occurrenceContext: { rootModuleName: "top", occurrencePath: ["u_left", "u_leaf"] }
  }));
  assert.deepEqual(entry.occurrenceContext, {
    rootModuleName: "top",
    occurrencePath: ["u_left", "u_leaf"]
  });
  entry.occurrenceContext.occurrencePath.push("mutated");
  const next = createViewHistoryEntry(state("child", {
    occurrenceContext: { rootModuleName: "top", occurrencePath: ["u_left", "u_leaf"] }
  }));
  assert.deepEqual(next.occurrenceContext.occurrencePath, ["u_left", "u_leaf"]);
});
