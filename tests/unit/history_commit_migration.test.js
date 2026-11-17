import assert from "node:assert/strict";
import test from "node:test";
import { createAppState } from "../../src/app/appState.js";
import { createHistoryController } from "../../src/app/history_controller.js";
import { createSessionPersistenceController } from "../../src/app/session_persistence_controller.js";
import { createStateCommandsController } from "../../src/app/state_commands_controller.js";
import { createSelectionNavigationController } from "../../src/app/selection_navigation_controller.js";
import { createCanvasController } from "../../src/app/canvas_controller.js";
import { createSingleViewSessionBridge } from "../../src/app/single_view_session_bridge.js";
import { createCompareViewSessionBridge } from "../../src/app/compare_view_session_bridge.js";
import { createViewSessionStore } from "../../src/application/view_session_store.js";
import { createViewHistoryEntry } from "../../src/app/viewHistory.js";
import { createSingleWorkspaceIdentity, createCompareWorkspaceIdentity } from "../../src/app/workspace_identity.js";
import { DEFAULT_LAYOUT_POLICY } from "../../src/layout/layoutPolicy.js";
import { parseVerilog } from "../../src/parser/verilogParser.js";
import { buildWorkspaceGraph } from "../../src/domains/netlist/netlist_graph_projection.js";

function setup(t, { compare = false } = {}) {
  const callbacks = new Map();
  let nextTimer = 0;
  t.mock.method(globalThis, "setTimeout", (callback) => {
    const timer = ++nextTimer;
    callbacks.set(timer, callback);
    return timer;
  });
  t.mock.method(globalThis, "clearTimeout", (timer) => callbacks.delete(timer));
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const writes = [];
  let storageError = null;
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
    setItem(key, value) {
      if (storageError) throw storageError;
      writes.push({ key, value: JSON.parse(value) });
    }
  } });
  t.after(() => {
    if (storageDescriptor) Object.defineProperty(globalThis, "sessionStorage", storageDescriptor);
    else delete globalThis.sessionStorage;
  });

  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  state.currentSource = "module top(input a, output y); BUF u(.A(a),.Y(y)); endmodule module peer(input a, output y); INV v(.A(a),.Y(y)); endmodule";
  state.design = parseVerilog(state.currentSource);
  state.document = { documentId: "history-test", domainId: "netlist" };
  state.currentModule = state.design.modules[0];
  state.fullGraph = state.graph = buildWorkspaceGraph(state.currentModule);
  state.compare.active = compare;
  state.compare.leftModuleName = "top";
  state.compare.rightModuleName = "peer";
  state.compare.fullGraphs = { left: state.fullGraph, right: buildWorkspaceGraph(state.design.modules[1]) };
  state.compare.graphs = { ...state.compare.fullGraphs };

  let history;
  let persistence;
  let commands;
  let selection;
  let layouts = 0;
  const renderRequests = [];
  const logs = [];
  const viewSessions = createViewSessionStore();
  const bridgeOptions = { state, sessions: viewSessions, getDocumentId: () => state.document.documentId,
    onDispatch: (...args) => history.noteViewCommandDispatch(...args) };
  const singleViewSession = createSingleViewSessionBridge(bridgeOptions);
  const compareViewSessions = createCompareViewSessionBridge(bridgeOptions);
  const noOp = () => {};
  const services = new Proxy({
    singleViewSession, compareViewSessions,
    recordViewHistory: (...args) => history.recordViewHistory(...args),
    persistSession: () => persistence.persistSession(),
    setSingleTransform: (...args) => commands.setSingleTransform(...args),
    setSelectedNode: (...args) => selection.setSelectedNode(...args),
    setSelectedNet: (...args) => selection.setSelectedNet(...args),
    renderCurrentModuleGraph: (options) => { layouts++; renderRequests.push({ kind: "single", options }); },
    renderCompareGraphs: (options) => { layouts++; renderRequests.push({ kind: "compare", options }); },
    getCompareModule: (side) => state.design.modules.find((module) => module.name === state.compare[`${side}ModuleName`]),
    logProcess: (...args) => logs.push(args),
    schematicSelectionController: {
      selectNode: (nodeId) => selection.handleSingleNodeSelection(nodeId),
      selectNet: (netName) => selection.handleSingleNetSelection(netName)
    }
  }, { get: (target, key) => key in target ? target[key] : noOp });
  const elements = new Proxy({ moduleBackButton: {}, moduleForwardButton: {},
    canvas: { classList: { toggle: noOp } }, mount: { querySelector: () => ({ setAttribute: noOp }) }
  }, { get: (target, key) => target[key] ||= {} });
  persistence = createSessionPersistenceController({ state, elements, services });
  history = createHistoryController({ state, elements, services });
  commands = createStateCommandsController({ state, elements, services });
  selection = createSelectionNavigationController({ state, elements, services });
  singleViewSession.importQuery({});
  if (compare) { compareViewSessions.ensure("left"); compareViewSessions.ensure("right"); }
  history.recordViewHistory({ label: "Initial view" });
  return { state, elements, services, history, persistence, commands, selection, singleViewSession, compareViewSessions, viewSessions, logs, writes, renderRequests,
    layouts: () => layouts,
    completeRender() {
      const request = renderRequests.at(-1);
      assert.ok(request, "Expected a scheduled workspace render");
      if (request.kind === "single") request.options.onRendered(state.graph);
      else request.options.onCommitted();
    },
    failStorage: (error) => { storageError = error; },
    flushStorage() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback();
    }
  };
}

test("session saving neither appends history nor consumes pending command metadata", (t) => {
  const h = setup(t);
  h.commands.setSingleTransform({ x: 13, y: 8, scale: 2 });
  const pending = h.state.pendingViewCommandMetadata;
  assert.ok(pending);
  const before = JSON.stringify(h.state.viewHistory);
  h.persistence.persistSession();
  h.persistence.persistSession();
  assert.equal(JSON.stringify(h.state.viewHistory), before);
  assert.equal(h.state.pendingViewCommandMetadata, pending);
  h.flushStorage();
  assert.equal(h.writes.length, 1);
  assert.deepEqual(h.writes[0].value.transform, { x: 13, y: 8, scale: 2 });
  assert.equal(JSON.stringify(h.state.viewHistory), before);
  assert.equal(h.state.pendingViewCommandMetadata, pending);
});

test("an explicit history record does not schedule a session save", (t) => {
  const h = setup(t);
  h.singleViewSession.dispatch({ type: "view.depths.set", faninDepth: 2, fanoutDepth: 5 });
  h.history.recordViewHistory({ label: "Record only" });
  assert.equal(h.state.viewHistory.entries.length, 2);
  h.flushStorage();
  assert.equal(h.writes.length, 0);
});

test("viewport preview frames remain history-free and one gesture commit saves once", (t) => {
  const h = setup(t);
  const revision = h.viewSessions.require("single:primary").computationRevision;
  for (let frame = 1; frame <= 20; frame++) {
    h.commands.setSingleTransform({ x: frame, y: frame * 2, scale: 1 });
    h.commands.applyTransform(false);
  }
  assert.equal(h.state.viewHistory.entries.length, 1);
  h.flushStorage();
  assert.equal(h.writes.length, 0);
  h.history.commitViewHistory({ label: "Viewport gesture" });
  h.flushStorage();
  assert.equal(h.state.viewHistory.entries.length, 2);
  assert.equal(h.writes.length, 1);
  assert.deepEqual(h.state.viewHistory.entries[1].transform, { x: 20, y: 40, scale: 1 });
  assert.equal(h.viewSessions.require("single:primary").computationRevision, revision);
  assert.equal(h.layouts(), 0);
});

test("a depth operation records its final viewport once despite nested setters and saving", (t) => {
  const h = setup(t);
  h.history.runViewHistoryTransaction({ label: "Change Focused depth" }, () => {
    h.commands.setSingleFocusedDepths(0, 8);
    h.history.runViewHistoryTransaction({ label: "Reset view" }, () => {
      h.commands.setSingleTransform({ x: 9, y: 4, scale: 1.5 });
      h.commands.applyTransform();
      h.history.recordViewHistory();
    });
  });
  assert.equal(h.state.viewHistory.entries.length, 2);
  const entry = h.state.viewHistory.entries[1];
  assert.equal(entry.label, "Change Focused depth");
  assert.deepEqual([entry.faninDepth, entry.fanoutDepth], [0, 8]);
  assert.deepEqual(entry.transform, { x: 9, y: 4, scale: 1.5 });
  assert.deepEqual(h.state.viewHistory.entries[0].transform, { x: 0, y: 0, scale: 1 });
  h.flushStorage();
  assert.equal(h.state.viewHistory.entries.length, 2);
});

test("bound render completion updates the original operation instead of appending history", (t) => {
  const h = setup(t);
  let callbacks;
  h.history.runViewHistoryTransaction({ label: "Reveal cell" }, () => {
    h.commands.setSingleFocusedDepths(1, 4);
    callbacks = h.history.bindViewHistoryCallbacks({ onRendered() {
      h.selection.setSelectedNode("cell:u");
      h.commands.setSingleTransform({ x: 20, y: 12, scale: 2 });
      h.commands.applyTransform();
      h.history.recordViewHistory();
    } });
  });
  const transactionId = h.state.viewHistory.entries[1].transactionId;
  callbacks.onRendered();
  assert.equal(h.state.viewHistory.entries.length, 2);
  const entry = h.state.viewHistory.entries[1];
  assert.equal(entry.transactionId, transactionId);
  assert.equal(entry.label, "Reveal cell");
  assert.equal(entry.selectedNodeId, "cell:u");
  assert.deepEqual(entry.transform, { x: 20, y: 12, scale: 2 });
});

test("an operation with no synchronous change records its first asynchronous change and preserves the undo baseline", (t) => {
  const h = setup(t);
  const baseline = JSON.stringify(h.state.viewHistory.entries[0]);
  let unchangedReady;
  let selectionReady;
  let viewportReady;
  h.history.runViewHistoryTransaction({ label: "Locate after render" }, () => {
    unchangedReady = h.history.bindViewHistoryCallbacks();
    selectionReady = h.history.bindViewHistoryCallbacks({ onRendered() {
      h.selection.setSelectedNode("cell:u");
      h.history.recordViewHistory();
    } });
    viewportReady = h.history.bindViewHistoryCallbacks({ onRendered() {
      h.commands.setSingleTransform({ x: 21, y: 34, scale: 1.5 });
      h.history.recordViewHistory();
    } });
  });
  assert.equal(h.state.viewHistory.entries.length, 1, "an unchanged synchronous phase must not append an empty operation");
  unchangedReady.onRendered();
  assert.equal(h.state.viewHistory.entries.length, 1, "an unchanged continuation must retain the pending operation without an empty entry");
  assert.equal(JSON.stringify(h.state.viewHistory.entries[0]), baseline);
  selectionReady.onRendered();
  assert.equal(h.state.selectedNodeId, "cell:u");
  assert.equal(h.state.viewHistory.entries.length, 2, "the first changed continuation needs its own history entry");
  const operationId = h.state.viewHistory.entries[1].transactionId;
  viewportReady.onRendered();
  assert.equal(h.state.viewHistory.entries.length, 2, "later phases of that operation must update the same entry");
  assert.equal(h.state.viewHistory.entries[1].transactionId, operationId);
  assert.equal(h.state.viewHistory.entries[1].label, "Locate after render");
  assert.equal(h.state.viewHistory.entries[1].selectedNodeId, "cell:u");
  assert.deepEqual(h.state.viewHistory.entries[1].transform, { x: 21, y: 34, scale: 1.5 });
  assert.equal(JSON.stringify(h.state.viewHistory.entries[0]), baseline, "claiming a continuation must not replace the undo baseline");
  h.history.navigateViewHistory(-1);
  h.completeRender();
  assert.equal(h.state.selectedNodeId, null);
  assert.deepEqual(h.state.transform, { x: 0, y: 0, scale: 1 });
});

test("a repeated pending query records the new operation's final selection and viewport after synchronous deduplication", (t) => {
  const h = setup(t);
  let first;
  let repeated;
  let firstCancelled = 0;
  h.history.runViewHistoryTransaction({ label: "First depth request" }, () => {
    h.commands.setSingleFocusedDepths(1, 4);
    first = h.history.bindViewHistoryCallbacks({
      onRendered: () => h.commands.setSingleTransform({ x: 999, y: 999, scale: 3 }),
      onCancelled: () => { firstCancelled++; }
    });
  });
  const firstEntry = JSON.stringify(h.state.viewHistory.entries[1]);
  h.history.runViewHistoryTransaction({ label: "Repeat pending depth request" }, () => {
    h.commands.setSingleFocusedDepths(1, 4);
    repeated = h.history.bindViewHistoryCallbacks({ onRendered() {
      h.selection.setSelectedNode("cell:u");
      h.commands.setSingleTransform({ x: 45, y: 67, scale: 2 });
      h.history.recordViewHistory();
    } });
  });
  assert.equal(h.state.viewHistory.entries.length, 2, "the repeated query has no synchronous snapshot delta");
  repeated.onRendered();
  assert.equal(h.state.viewHistory.entries.length, 3, "the new operation's asynchronous delta must be undoable exactly once");
  const finalEntry = h.state.viewHistory.entries[2];
  assert.equal(finalEntry.label, "Repeat pending depth request");
  assert.equal(finalEntry.selectedNodeId, "cell:u");
  assert.deepEqual(finalEntry.transform, { x: 45, y: 67, scale: 2 });
  assert.equal(JSON.stringify(h.state.viewHistory.entries[1]), firstEntry);
  const beforeStaleCompletion = JSON.stringify(h.state.viewHistory);
  first.onRendered();
  assert.equal(firstCancelled, 1);
  assert.equal(JSON.stringify(h.state.viewHistory), beforeStaleCompletion);
  assert.deepEqual(h.state.transform, finalEntry.transform);
  h.history.navigateViewHistory(-1);
  h.completeRender();
  assert.deepEqual([h.state.faninDepth, h.state.fanoutDepth], [1, 4]);
  assert.equal(h.state.selectedNodeId, null);
  assert.deepEqual(h.state.transform, { x: 0, y: 0, scale: 1 });
});

test("Promise completion can append the first changed snapshot of an otherwise unchanged operation", async (t) => {
  const h = setup(t);
  let complete;
  const deferred = new Promise((resolve) => { complete = resolve; });
  const operation = h.history.runViewHistoryTransaction({ label: "Deferred selection" }, async () => {
    await deferred;
    h.singleViewSession.dispatch({ type: "selection.set", objectRef: h.singleViewSession.objectRefForNode(
      h.state.fullGraph.nodes.find((node) => node.id === "cell:u")) });
    return "selected";
  });
  assert.equal(h.state.viewHistory.entries.length, 1);
  complete();
  assert.equal(await operation, "selected");
  assert.equal(h.state.viewHistory.entries.length, 2);
  assert.equal(h.state.viewHistory.entries[0].selectedNodeId, null);
  assert.equal(h.state.viewHistory.entries[1].selectedNodeId, "cell:u");
  assert.equal(h.state.viewHistory.entries[1].label, "Deferred selection");
});

test("late completion cannot append history or overwrite a newer user operation", (t) => {
  const h = setup(t);
  let callbacks;
  let cancelled = 0;
  h.history.runViewHistoryTransaction({ label: "First operation" }, () => {
    h.commands.setSingleFocusedDepths(1, 4);
    callbacks = h.history.bindViewHistoryCallbacks({
      onRendered() {
        h.commands.setSingleFocusedDepths(99, 99);
        h.commands.setSingleTransform({ x: 99, y: 99, scale: 2 });
        h.selection.setSelectedNode("cell:u");
        h.history.recordViewHistory();
      },
      onCancelled: () => { cancelled++; }
    });
  });
  h.history.runViewHistoryTransaction({ label: "Second operation" }, () => h.commands.setSingleFocusedDepths(7, 9));
  const before = JSON.stringify(h.state.viewHistory);
  const query = h.singleViewSession.readQuery();
  const transform = { ...h.state.transform };
  callbacks.onRendered();
  assert.equal(cancelled, 1);
  assert.deepEqual(h.singleViewSession.readQuery(), query);
  assert.deepEqual(h.state.transform, transform);
  assert.equal(h.state.selectedNodeId, null);
  assert.equal(JSON.stringify(h.state.viewHistory), before);
  assert.equal(h.state.viewHistory.entries.length, 3);
  assert.equal(h.state.viewHistory.entries[2].label, "Second operation");
});

test("Back and Forward cannot reactivate an old callback when its history identity becomes current again", (t) => {
  const h = setup(t);
  let callbacks;
  let cancelled = 0;
  h.history.runViewHistoryTransaction({ label: "Reveal pending cell" }, () => {
    h.commands.setSingleFocusedDepths(1, 4);
    callbacks = h.history.bindViewHistoryCallbacks({
      onRendered() {
        h.selection.setSelectedNode("cell:u");
        h.commands.setSingleTransform({ x: 300, y: 400, scale: 3 });
      },
      onCancelled: () => { cancelled++; }
    });
  });
  const transactionId = h.state.viewHistory.entries[1].transactionId;
  let prevented = 0;
  const shortcut = (key) => h.history.handleModuleHistoryShortcut({
    altKey: true, key, preventDefault() { prevented++; }
  });
  shortcut("ArrowLeft");
  h.completeRender();
  shortcut("ArrowRight");
  h.completeRender();
  assert.equal(prevented, 2);
  assert.equal(h.state.viewHistory.entries[h.state.viewHistory.index].transactionId, transactionId);
  const before = JSON.stringify(h.state.viewHistory);
  const transform = { ...h.state.transform };
  callbacks.onRendered();
  assert.equal(cancelled, 1);
  assert.equal(h.state.selectedNodeId, null);
  assert.deepEqual(h.state.transform, transform);
  assert.equal(JSON.stringify(h.state.viewHistory), before);
});

for (const compare of [false, true]) {
  test(`${compare ? "Compare" : "Single"} selection-only history restore reuses its committed graphs`, (t) => {
    const h = setup(t, { compare });
    const original = createViewHistoryEntry(h.state);
    const graphs = compare ? { ...h.state.compare.graphs } : h.state.graph;
    if (compare) {
      h.state.compare.workspaceIdentity = createCompareWorkspaceIdentity(h.state);
      h.compareViewSessions.dispatch("left", { type: "selection.set",
        objectRef: h.compareViewSessions.objectRef("left", "cell", "u") });
    } else {
      h.state.singleWorkspaceIdentity = createSingleWorkspaceIdentity(h.state);
      h.selection.setSelectedNode("cell:u", false);
    }
    h.history.restoreViewHistoryEntry(original);
    assert.equal(h.layouts(), 0);
    assert.equal(h.state.restoringViewHistory, false);
    assert.deepEqual(compare ? h.state.compare.graphs : h.state.graph, graphs);
    assert.equal(compare ? h.state.compare.selectedName : h.state.selectedNodeId, null);
  });

  test(`${compare ? "Compare" : "Single"} Fit resets viewports and records one history operation`, (t) => {
    const h = setup(t, { compare });
    const viewport = { x: 45, y: 60, scale: 2 };
    const setCompare = (side, value) => h.compareViewSessions.dispatch(side, { type: "viewport.set", viewport: value });
    if (compare) for (const side of ["left", "right"]) setCompare(side, viewport);
    else h.commands.setSingleTransform(viewport);
    h.history.recordViewHistory();
    const before = h.state.viewHistory.entries.length;
    let wheelFlushes = 0;
    const canvas = createCanvasController({ state: h.state, elements: h.elements, services: {
      ...h.services, setCompareTransform: setCompare, applyTransform: h.commands.applyTransform,
      wheelGestureController: { flush() { wheelFlushes++; } },
      applyCompareTransforms() {}, setStatus() {}
    } });
    h.history.runViewHistoryTransaction({ label: "Fit view" }, () => canvas.fitToView());
    assert.equal(h.state.viewHistory.entries.length, before + 1);
    assert.equal(wheelFlushes, 1);
    assert.equal(h.layouts(), 0);
    for (const value of compare ? Object.values(h.state.compare.transforms) : [h.state.transform]) {
      assert.deepEqual(value, { x: 0, y: 0, scale: 1 });
    }
  });

  test(`${compare ? "Compare" : "Single"} undo rebuilds an Adjust graph whose published identity still describes the automatic graph`, (t) => {
    const h = setup(t, { compare });
    const original = createViewHistoryEntry(h.state);
    const originalIdentity = compare ? createCompareWorkspaceIdentity(h.state) : createSingleWorkspaceIdentity(h.state);
    if (compare) {
      h.state.compare.workspaceIdentity = originalIdentity;
      h.compareViewSessions.importState("left", { nodePositions: new Map([["cell:u", { x: 100, y: 200 }]]) });
      h.state.compare.graphs.left = { ...h.state.compare.graphs.left,
        nodes: h.state.compare.graphs.left.nodes.map((node) => node.id === "cell:u" ? { ...node, x: 100, y: 200 } : node) };
      assert.notEqual(createCompareWorkspaceIdentity(h.state), originalIdentity);
    } else {
      h.state.singleWorkspaceIdentity = originalIdentity;
      h.singleViewSession.importState({ nodePositions: new Map([["cell:u", { x: 100, y: 200 }]]) });
      h.state.graph = { ...h.state.graph,
        nodes: h.state.graph.nodes.map((node) => node.id === "cell:u" ? { ...node, x: 100, y: 200 } : node) };
      assert.notEqual(createSingleWorkspaceIdentity(h.state), originalIdentity);
    }
    h.history.restoreViewHistoryEntry(original);
    // The restored input now matches the old identity, but the currently shown
    // graph was changed by Adjust. Reusing it would leave the move visible.
    assert.equal(compare ? createCompareWorkspaceIdentity(h.state) : createSingleWorkspaceIdentity(h.state), originalIdentity);
    assert.equal(h.layouts(), 1);
    assert.equal(h.renderRequests[0].kind, compare ? "compare" : "single");
    assert.equal(h.state.restoringViewHistory, true);
    h.completeRender();
    assert.equal(h.state.restoringViewHistory, false);
    assert.equal(h.state.viewHistory.entries.length, 1);
  });
}

test("Compare history restoration saves its final query after rendering without appending history", (t) => {
  const h = setup(t, { compare: true });
  h.history.runViewHistoryTransaction({ label: "Change Compare depth" }, () => {
    h.singleViewSession.importQuery({ coneDepth: 8, faninDepth: 0, fanoutDepth: 5 });
  });
  h.flushStorage();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].value.coneDepth, 8);
  h.history.navigateViewHistory(-1);
  assert.equal(h.state.restoringViewHistory, true);
  assert.equal(h.state.coneDepth, 3);
  const historyBeforeCompletion = JSON.stringify(h.state.viewHistory);
  h.flushStorage();
  assert.equal(h.writes.length, 1, "Restoration has not finished yet");
  h.completeRender();
  h.flushStorage();
  assert.equal(h.writes.length, 2);
  assert.deepEqual([h.writes[1].value.coneDepth, h.writes[1].value.faninDepth, h.writes[1].value.fanoutDepth], [3, 3, 3]);
  assert.equal(h.state.restoringViewHistory, false);
  assert.equal(JSON.stringify(h.state.viewHistory), historyBeforeCompletion);
  assert.equal(h.state.viewHistory.entries.length, 2);
});

test("an asynchronous operation does not absorb later user input into its history", async (t) => {
  const h = setup(t);
  let complete;
  const completion = new Promise((resolve) => { complete = resolve; });
  const operation = h.history.runViewHistoryTransaction({ label: "Import snapshot" }, () => {
    h.commands.setSingleFocusedDepths(0, 5);
    return completion;
  });
  h.history.runViewHistoryTransaction({ label: "Pan viewport" }, () => h.commands.setSingleTransform({ x: 30, y: 40, scale: 1 }));
  const before = JSON.stringify(h.state.viewHistory);
  complete("done");
  assert.equal(await operation, "done");
  assert.equal(JSON.stringify(h.state.viewHistory), before);
  assert.equal(h.state.viewHistory.entries.length, 3);
});

test("pure selection and viewport operations preserve computation and never schedule layout", (t) => {
  const h = setup(t);
  const revision = h.viewSessions.require("single:primary").computationRevision;
  h.history.runViewHistoryTransaction({ label: "Select cell" }, () => h.selection.setSelectedNode("cell:u"));
  h.history.runViewHistoryTransaction({ label: "Pan viewport" }, () => {
    h.commands.setSingleTransform({ x: 15, y: 8, scale: 1 });
    h.commands.applyTransform();
  });
  assert.equal(h.state.viewHistory.entries.length, 3);
  assert.equal(h.viewSessions.require("single:primary").computationRevision, revision);
  assert.equal(h.layouts(), 0);
});

test("one Compare operation records both sides and its owning override in one entry", (t) => {
  const h = setup(t, { compare: true });
  h.history.runViewHistoryTransaction({ label: "Adjust Compare" }, () => {
    h.commands.setCompareOverrides("left", { nodePositions: new Map([["cell:u", { x: 15, y: 20 }]]) });
    h.compareViewSessions.dispatch("left", { type: "viewport.set", viewport: { x: 1, y: 2, scale: 1 } });
    h.compareViewSessions.dispatch("right", { type: "viewport.set", viewport: { x: 3, y: 4, scale: 1 } });
    h.history.recordViewHistory();
  });
  assert.equal(h.state.viewHistory.entries.length, 2);
  const entry = h.state.viewHistory.entries[1];
  assert.equal(entry.label, "Adjust Compare");
  assert.deepEqual(entry.compare.transforms, { left: { x: 1, y: 2, scale: 1 }, right: { x: 3, y: 4, scale: 1 } });
  assert.deepEqual(entry.compare.overrides.left.nodePositions, [["cell:u", { x: 15, y: 20 }]]);
  assert.deepEqual(new Set(entry.affectedSessionIds), new Set(["compare:left", "compare:right"]));
});

test("restoration and unchanged commands do not append history", (t) => {
  const h = setup(t);
  h.history.runViewHistoryTransaction({ label: "Same depths" }, () => h.commands.setSingleFocusedDepths(3, 3));
  assert.equal(h.state.viewHistory.entries.length, 1);
  h.state.restoringViewHistory = true;
  h.history.runViewHistoryTransaction({ label: "Restore depths" }, () => h.commands.setSingleFocusedDepths(1, 7));
  h.persistence.persistSession();
  h.flushStorage();
  assert.equal(h.state.viewHistory.entries.length, 1);
});

test("save failures and recovery leave committed history unchanged", (t) => {
  const h = setup(t);
  const failure = new Error("Storage quota exceeded");
  h.history.runViewHistoryTransaction({ label: "Change depths" }, () => h.commands.setSingleFocusedDepths(2, 6));
  const before = JSON.stringify(h.state.viewHistory);
  h.failStorage(failure);
  h.persistence.persistSession();
  h.flushStorage();
  h.persistence.persistSession();
  h.flushStorage();
  assert.equal(JSON.stringify(h.state.viewHistory), before);
  assert.equal(h.logs.length, 1);
  assert.equal(h.logs[0][3].error, failure);
  h.failStorage(null);
  h.persistence.persistSession();
  h.flushStorage();
  assert.equal(h.logs.length, 2);
  assert.match(h.logs[1][2], /recovered/);
  assert.equal(JSON.stringify(h.state.viewHistory), before);
});
