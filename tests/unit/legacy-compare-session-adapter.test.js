import assert from "node:assert/strict";
import test from "node:test";
import { createLegacyCompareSessionAdapter } from "../../src/app/legacy_compare_session_adapter.js";

test("compare legacy roots mirror two ordinary isolated ViewSessions", () => {
  const state = {
    compare: {
      leftModuleName: "before",
      rightModuleName: "after",
      fullGraphs: {
        left: { nodes: [{ id: "cell:a", kind: "cell" }] },
        right: { nodes: [{ id: "cell:b", kind: "cell" }] }
      }
    }
  };
  const adapter = createLegacyCompareSessionAdapter({ state, getDocumentId: () => "doc:1" });
  const left = adapter.replaceRoots("left", ["cell:a"], "cell:a");
  const right = adapter.replaceRoots("right", ["cell:b"], "cell:b");
  assert.equal(left.session.sessionId, "compare:left");
  assert.equal(right.session.sessionId, "compare:right");
  assert.deepEqual(left.rootNodeIds, ["cell:a"]);
  assert.deepEqual(right.rootNodeIds, ["cell:b"]);
  assert.notEqual(adapter.sessions.require("compare:left"), adapter.sessions.require("compare:right"));
});

test("compare session identity resets when its module changes", () => {
  const state = {
    compare: {
      leftModuleName: "one",
      rightModuleName: "two",
      fullGraphs: { left: { nodes: [{ id: "cell:x", kind: "cell" }] }, right: { nodes: [] } }
    }
  };
  const adapter = createLegacyCompareSessionAdapter({ state, getDocumentId: () => "doc:1" });
  adapter.replaceRoots("left", ["cell:x"]);
  state.compare.leftModuleName = "replacement";
  const replacement = adapter.replaceRoots("left", []);
  assert.equal(replacement.session.unitId, "replacement");
  assert.deepEqual(replacement.session.focusedRootRefs, []);
});

test("compare viewport commands stay isolated and preserve computation revision", () => {
  const state = {
    layoutPolicy: { name: "default" },
    compare: {
      leftModuleName: "before", rightModuleName: "after",
      transforms: { left: { x: 0, y: 0, scale: 1 }, right: { x: 0, y: 0, scale: 1 } },
      nodePositions: { left: new Map(), right: new Map() },
      nodeSizes: { left: new Map(), right: new Map() },
      graphOverrides: {
        left: { nodeProperties: {}, cellPinDirections: {} },
        right: { nodeProperties: {}, cellPinDirections: {} }
      },
      fullGraphs: { left: { nodes: [] }, right: { nodes: [] } }
    }
  };
  const adapter = createLegacyCompareSessionAdapter({ state, getDocumentId: () => "doc:1" });
  adapter.dispatch("left", { type: "selection.clear" });
  const before = adapter.sessions.require("compare:left").computationRevision;
  const result = adapter.dispatch("left", { type: "viewport.set", viewport: { x: 9, y: 5, scale: 1.2 } });
  assert.deepEqual(state.compare.transforms.left, { x: 9, y: 5, scale: 1.2 });
  assert.deepEqual(state.compare.transforms.right, { x: 0, y: 0, scale: 1 });
  assert.equal(result.session.computationRevision, before);
});
