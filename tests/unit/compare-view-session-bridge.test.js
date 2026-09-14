import assert from "node:assert/strict";
import test from "node:test";
import { createCompareViewSessionBridge } from "../../src/app/compare_view_session_bridge.js";
import { createSingleViewSessionBridge } from "../../src/app/single_view_session_bridge.js";
import { createViewSessionStore } from "../../src/application/view_session_store.js";

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
  const adapter = createCompareViewSessionBridge({ state, getDocumentId: () => "doc:1" });
  const left = adapter.replaceRoots("left", ["cell:a"], "cell:a");
  const right = adapter.replaceRoots("right", ["cell:b"], "cell:b");
  assert.equal(left.session.sessionId, "compare:left");
  assert.equal(right.session.sessionId, "compare:right");
  assert.deepEqual(left.rootNodeIds, ["cell:a"]);
  assert.deepEqual(right.rootNodeIds, ["cell:b"]);
  assert.notEqual(adapter.sessions.require("compare:left"), adapter.sessions.require("compare:right"));
  const before = adapter.sessions.require("compare:left").computationRevision;
  const activated = adapter.dispatch("left", {
    type: "focus.activate",
    objectRef: adapter.objectRef("left", "cell", "cell:a")
  });
  assert.equal(state.compare.activeFocusedRootNodeId.left, "cell:a");
  assert.equal(activated.session.computationRevision, before);
});

test("compare bridge exposes independent computation boundaries", () => {
  const state = {
    compare: {
      leftModuleName: "left",
      rightModuleName: "right",
      fullGraphs: { left: { nodes: [] }, right: { nodes: [] } }
    },
    layoutPolicy: { name: "default" },
    presentationPolicy: { gateSymbolMode: "rectangle" }
  };
  const adapter = createCompareViewSessionBridge({ state, getDocumentId: () => "doc:1" });
  const leftBefore = adapter.beginComputation("left");
  const rightBefore = adapter.beginComputation("right");
  const leftNext = adapter.beginComputation("left");
  assert.equal(leftNext.computationRevision, leftBefore.computationRevision + 1);
  assert.equal(adapter.sessions.require("compare:right").computationRevision, rightBefore.computationRevision);
});

test("compare session identity resets when its module changes", () => {
  const state = {
    compare: {
      leftModuleName: "one",
      rightModuleName: "two",
      fullGraphs: { left: { nodes: [{ id: "cell:x", kind: "cell" }] }, right: { nodes: [] } }
    }
  };
  const adapter = createCompareViewSessionBridge({ state, getDocumentId: () => "doc:1" });
  adapter.replaceRoots("left", ["cell:x"]);
  state.compare.leftModuleName = "replacement";
  const replacement = adapter.replaceRoots("left", []);
  assert.equal(replacement.session.unitId, "replacement");
  assert.deepEqual(replacement.session.focusedRootRefs, []);
});

test("compare roots keep canonical ObjectRefs while projecting escaped graph node ids", () => {
  const state = {
    compare: {
      leftModuleName: "before", rightModuleName: "after",
      fullGraphs: {
        left: { nodes: [{ id: "cell:u_0_", kind: "cell", ref: { instance: "u[0]" } }] },
        right: { nodes: [] }
      }
    }
  };
  const adapter = createCompareViewSessionBridge({ state, getDocumentId: () => "doc:1" });
  const result = adapter.replaceRoots("left", ["cell:u_0_"], "cell:u_0_");
  assert.deepEqual(result.rootNodeIds, ["cell:u_0_"]);
  assert.equal(result.session.focusedRootRefs[0].localId, "u[0]");
  adapter.dispatch("left", {
    type: "focus.activate",
    objectRef: adapter.objectRef("left", "cell", "cell:u_0_")
  });
  assert.equal(state.compare.activeFocusedRootNodeId.left, "cell:u_0_");
});

test("compare roots preserve occurrence identity when local ids repeat", () => {
  const state = {
    compare: {
      leftModuleName: "leaf", rightModuleName: "leaf",
      fullGraphs: {
        left: { nodes: [
          { id: "cell:u_left", kind: "cell", ref: { kind: "cell", localId: "leaf", occurrencePath: ["u_left"] } },
          { id: "cell:u_right", kind: "cell", ref: { kind: "cell", localId: "leaf", occurrencePath: ["u_right"] } }
        ] },
        right: { nodes: [] }
      }
    }
  };
  const adapter = createCompareViewSessionBridge({ state, getDocumentId: () => "doc:1" });
  const result = adapter.replaceRoots("left", ["cell:u_right"], "cell:u_right");
  assert.equal(result.session.focusedRootRefs[0].localId, "leaf");
  assert.deepEqual(result.session.focusedRootRefs[0].occurrencePath, ["u_right"]);
  assert.equal(result.rootNodeIds[0], "cell:u_right");
  assert.deepEqual(state.compare.focusedRootRefs.left[0].occurrencePath, ["u_right"]);

  const restored = adapter.ensure("left");
  assert.deepEqual(restored.focusedRootRefs[0].occurrencePath, ["u_right"]);
  assert.equal(state.compare.focusedRootNodeIds.left[0], "cell:u_right");
});

test("compare selection refs retain occurrence identity for repeated local ids", () => {
  const state = {
    compare: {
      leftModuleName: "leaf", rightModuleName: "leaf",
      fullGraphs: {
        left: { nodes: [
          { id: "cell:u_left", kind: "cell", ref: { kind: "cell", localId: "leaf", occurrencePath: ["u_left"] } },
          { id: "cell:u_right", kind: "cell", ref: { kind: "cell", localId: "leaf", occurrencePath: ["u_right"] } }
        ] },
        right: { nodes: [] }
      }
    }
  };
  const adapter = createCompareViewSessionBridge({ state, getDocumentId: () => "doc:1" });
  const objectRef = adapter.objectRef("left", "cell", "cell:u_right");
  const result = adapter.dispatch("left", { type: "selection.set", objectRef });
  assert.equal(result.session.selectedObjectRef.localId, "leaf");
  assert.deepEqual(result.session.selectedObjectRef.occurrencePath, ["u_right"]);
});

test("compare net selection refs retain projected hub occurrence identity", () => {
  const state = {
    compare: {
      leftModuleName: "leaf", rightModuleName: "leaf",
      fullGraphs: {
        left: { nodes: [
          { id: "hub:u_left/n_out", kind: "hub", label: "n_out", ref: { kind: "net", localId: "n_out", occurrencePath: ["u_left"] } },
          { id: "hub:u_right/n_out", kind: "hub", label: "n_out", ref: { kind: "net", localId: "n_out", occurrencePath: ["u_right"] } }
        ] },
        right: { nodes: [] }
      }
    }
  };
  const adapter = createCompareViewSessionBridge({ state, getDocumentId: () => "doc:1" });
  const result = adapter.dispatch("left", {
    type: "selection.set",
    objectRef: adapter.objectRef("left", "net", "n_out")
  });
  assert.equal(result.session.selectedObjectRef.localId, "n_out");
  assert.deepEqual(result.session.selectedObjectRef.occurrencePath, ["u_left"]);
});

test("compare bridge imports restored root mirrors before the first command", () => {
  const state = {
    compare: {
      leftModuleName: "before", rightModuleName: "after",
      focusedRootNodeIds: { left: ["cell:a"], right: [] },
      activeFocusedRootNodeId: { left: "cell:a", right: null },
      fullGraphs: {
        left: { nodes: [{ id: "cell:a", kind: "cell", ref: { instance: "a" } }] },
        right: { nodes: [] }
      }
    }
  };
  const adapter = createCompareViewSessionBridge({ state, getDocumentId: () => "doc:1" });
  const session = adapter.ensure("left");
  assert.equal(session.viewMode, "focused");
  assert.equal(session.focusedRootRefs[0].localId, "a");
});

test("single and compare bridges can share the application ViewSession store", () => {
  const sessions = createViewSessionStore();
  const state = {
    currentModule: { name: "top" }, viewMode: "whole", faninDepth: 3, fanoutDepth: 3,
    focusedRootNodeIds: [], activeFocusedRootNodeId: null, fullGraph: { nodes: [] },
    transform: { x: 0, y: 0, scale: 1 }, layoutPolicy: {}, nodePositions: new Map(), nodeSizes: new Map(),
    graphOverrides: { nodeProperties: {}, cellPinDirections: {} },
    compare: { leftModuleName: "before", rightModuleName: "after", fullGraphs: { left: { nodes: [] }, right: { nodes: [] } } }
  };
  const getDocumentId = () => "doc:1";
  const single = createSingleViewSessionBridge({ state, getDocumentId, sessions });
  const compare = createCompareViewSessionBridge({ state, getDocumentId, sessions });
  single.dispatch({ type: "selection.clear" });
  compare.ensure("left");
  assert.deepEqual(sessions.list().map((session) => session.sessionId).sort(), ["compare:left", "single:primary"]);
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
  const adapter = createCompareViewSessionBridge({ state, getDocumentId: () => "doc:1" });
  adapter.dispatch("left", { type: "selection.clear" });
  const before = adapter.sessions.require("compare:left").computationRevision;
  const result = adapter.dispatch("left", { type: "viewport.set", viewport: { x: 9, y: 5, scale: 1.2 } });
  assert.deepEqual(state.compare.transforms.left, { x: 9, y: 5, scale: 1.2 });
  assert.deepEqual(state.compare.transforms.right, { x: 0, y: 0, scale: 1 });
  assert.equal(result.session.computationRevision, before);
});

test("compare selection commands project the active side without clearing its peer session", () => {
  const state = {
    layoutPolicy: {},
    compare: {
      leftModuleName: "before", rightModuleName: "after",
      transforms: { left: { x: 0, y: 0, scale: 1 }, right: { x: 0, y: 0, scale: 1 } },
      nodePositions: { left: new Map(), right: new Map() }, nodeSizes: { left: new Map(), right: new Map() },
      graphOverrides: { left: { nodeProperties: {}, cellPinDirections: {} }, right: { nodeProperties: {}, cellPinDirections: {} } },
      fullGraphs: { left: { nodes: [] }, right: { nodes: [] } },
      selectedKind: null, selectedName: null, selectedSide: null
    }
  };
  const adapter = createCompareViewSessionBridge({ state, getDocumentId: () => "doc:1" });
  adapter.dispatch("right", { type: "selection.set", objectRef: adapter.objectRef("right", "cell", "u2") });
  adapter.dispatch("left", { type: "selection.set", objectRef: adapter.objectRef("left", "cell", "u1") });
  assert.equal(state.compare.selectedSide, "left");
  assert.equal(state.compare.selectedName, "u1");
  assert.equal(adapter.sessions.require("compare:right").selectedObjectRef.localId, "u2");
});

test("compare override commands replace only their owning side", () => {
  const state = {
    layoutPolicy: {},
    compare: {
      leftModuleName: "before", rightModuleName: "after",
      transforms: { left: { x: 0, y: 0, scale: 1 }, right: { x: 0, y: 0, scale: 1 } },
      nodePositions: { left: new Map(), right: new Map([["keep", { x: 1, y: 2 }]]) },
      nodeSizes: { left: new Map(), right: new Map() },
      graphOverrides: { left: { nodeProperties: {}, cellPinDirections: {} }, right: { nodeProperties: {}, cellPinDirections: {} } },
      fullGraphs: { left: { nodes: [] }, right: { nodes: [] } }
    }
  };
  const adapter = createCompareViewSessionBridge({ state, getDocumentId: () => "doc:1" });
  adapter.dispatch("left", { type: "overrides.set", overrides: {
    nodePositions: new Map([["move", { x: 20, y: 24 }]]), nodeSizes: new Map(),
    graphOverrides: { nodeProperties: {}, cellPinDirections: {} }
  } });
  assert.deepEqual(state.compare.nodePositions.left.get("move"), { x: 20, y: 24 });
  assert.deepEqual(state.compare.nodePositions.right.get("keep"), { x: 1, y: 2 });
});
