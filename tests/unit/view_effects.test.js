import assert from "node:assert/strict";
import test from "node:test";
import { executeViewEffects, mergeViewEffects } from "../../src/application/view_effects.js";
import { createViewCommandHandlers } from "../../src/application/view_commands.js";
import { createViewSessionStore } from "../../src/application/view_session_store.js";
import { createObjectRef } from "../../src/contracts/object_ref.js";
import { createAppState } from "../../src/app/appState.js";
import { createSingleViewSessionBridge } from "../../src/app/single_view_session_bridge.js";
import { createCompareViewSessionBridge } from "../../src/app/compare_view_session_bridge.js";
import { createFocusedRootsController, focusedRootsPorts } from "../../src/app/focused_roots_controller.js";
import { createViewControlsController, viewControlsPorts } from "../../src/app/view_controls_controller.js";
import { createFocusNavigationController, focusNavigationPorts } from "../../src/app/focus_navigation_controller.js";
import { createLegacyPort } from "../../src/app/legacy_port.js";
import { DEFAULT_LAYOUT_POLICY } from "../../src/layout/layoutPolicy.js";
import { parseVerilog } from "../../src/parser/verilogParser.js";
import { buildWorkspaceGraph } from "../../src/domains/netlist/netlist_graph_projection.js";
import { createViewHistoryTransaction } from "../../src/app/viewHistoryTransaction.js";

test("effects separate real selection and viewport commands from computation", () => {
  const sessions = createViewSessionStore([{ sessionId: "s", documentId: "d", domainId: "netlist", unitId: "top" }]);
  const handlers = createViewCommandHandlers({ sessions });
  const events = [];
  const callbacks = {
    compute() { assert.fail("Pure selection/viewport must not compute"); },
    render: () => events.push("render"), viewport: () => events.push("viewport"),
    persist: () => events.push("save"), onCommitted: () => events.push("commit"), onUnchanged: () => events.push("noop")
  };
  const command = { sessionId: "s", objectRef: createObjectRef({ documentId: "d", unitId: "top", kind: "cell", localId: "u" }) };
  const revision = sessions.require("s").computationRevision;
  executeViewEffects(handlers["selection.set"](command), callbacks);
  assert.deepEqual(events, ["render", "commit"]);
  events.length = 0;
  executeViewEffects(handlers["selection.set"](command), callbacks);
  assert.deepEqual(events, ["noop"]);
  events.length = 0;
  executeViewEffects(handlers["viewport.set"]({ sessionId: "s", viewport: { x: 2, y: 3, scale: 1 } }), callbacks);
  assert.deepEqual(events, ["viewport", "commit", "save"]);
  assert.equal(sessions.require("s").computationRevision, revision);
});

test("compound effects schedule once and save after the settled UI and viewport", () => {
  const effects = mergeViewEffects({ query: true, render: true }, { layout: true, viewport: true, persist: true });
  const events = [];
  let completion;
  const result = { effects };
  assert.equal(executeViewEffects(result, {
    beforeCompute: () => events.push("prepare"),
    compute: (callbacks) => { events.push("compute"); completion = callbacks; },
    render: (graph) => events.push(graph), viewport: () => events.push("viewport"),
    onCommitted: () => events.push("commit"), persist: () => events.push("save")
  }), result);
  assert.deepEqual(events, ["prepare", "compute"]);
  completion.onRendered("graph");
  completion.onRendered("obsolete repeat");
  assert.deepEqual(events, ["prepare", "compute", "graph", "viewport", "commit", "save"]);
});

test("cancelled, failed and rejected effects never commit or save", () => {
  for (const outcome of ["onCancelled", "onFailed"]) {
    const events = [];
    let callbacks;
    executeViewEffects({ effects: { query: true, render: true, persist: true } }, {
      compute: (value) => { callbacks = value; },
      render: () => events.push("render"), persist: () => events.push("save"),
      onCommitted: () => events.push("commit"),
      [outcome]: (reason) => events.push(reason)
    });
    callbacks[outcome]("stopped");
    callbacks.onRendered("late graph");
    assert.deepEqual(events, ["stopped"]);
  }
  const events = [];
  executeViewEffects({ rejected: "capacity", effects: { query: true, persist: true } }, {
    beforeCompute() { assert.fail("Rejected command must not prepare computation"); },
    onRejected: (reason) => events.push(reason), persist() { assert.fail("Rejected command must not save"); }
  });
  assert.deepEqual(events, ["capacity"]);
});

test("settings outside the current query can save without computing", () => {
  const events = [];
  executeViewEffects({ effects: { query: true, layout: true, render: true, persist: true } }, {
    shouldCompute: false, compute() { assert.fail("Inactive query depth must not compute"); },
    persist: () => events.push("save")
  });
  assert.deepEqual(events, ["save"]);
});

function controllerHarness(compare = false) {
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  state.design = parseVerilog(`module top(input a, output y); BUF u(.A(a),.Y(y)); endmodule
    module peer(input a, output y); BUF u(.A(a),.Y(y)); endmodule`);
  state.document = { documentId: "d", domainId: "netlist" };
  state.currentModule = state.design.modules[0];
  state.fullGraph = state.graph = buildWorkspaceGraph(state.currentModule);
  state.singleWorkspaceIdentity = "committed";
  state.compare.active = compare;
  state.compare.leftModuleName = "top";
  state.compare.rightModuleName = "peer";
  state.compare.fullGraphs = { left: state.fullGraph, right: buildWorkspaceGraph(state.design.modules[1]) };
  state.compare.graphs = { ...state.compare.fullGraphs };
  state.compare.workspaceIdentity = "committed";
  const sessions = createViewSessionStore();
  const options = { state, sessions, getDocumentId: () => "d" };
  const singleViewSession = createSingleViewSessionBridge(options);
  const compareViewSessions = createCompareViewSessionBridge(options);
  const events = [];
  const renders = [];
  const noOp = () => {};
  const elements = new Proxy({}, { get: (target, name) => target[name] ||= { value: "3", classList: { toggle: noOp } } });
  const services = new Proxy({
    singleViewSession, compareViewSessions, SEARCH_FIRST_NODE_THRESHOLD: 1000,
    setSingleTransform: (viewport) => singleViewSession.dispatch({ type: "viewport.set", viewport }),
    setCompareTransform: (side, viewport) => compareViewSessions.dispatch(side, { type: "viewport.set", viewport }),
    setSingleViewMode: (viewMode) => singleViewSession.dispatch({ type: "view.mode.set", viewMode }),
    setSingleFocusedDepths: (faninDepth, fanoutDepth) => singleViewSession.dispatch({ type: "view.depths.set", faninDepth, fanoutDepth }),
    setSelectedNode: (nodeId) => singleViewSession.dispatch(nodeId ? {
      type: "selection.set", objectRef: singleViewSession.objectRefForNode(state.fullGraph.nodes.find((node) => node.id === nodeId))
    } : { type: "selection.clear" }),
    renderCurrentModuleGraph: (callbacks) => {
      state.singleWorkspaceIdentity = null;
      renders.push(callbacks); events.push("single");
      state.singleWorkspaceIdentity = "committed";
      callbacks.onRendered?.(state.graph);
    },
    renderCompareGraphs: (callbacks) => {
      state.compare.workspaceIdentity = null;
      renders.push(callbacks); events.push("compare");
      state.compare.workspaceIdentity = "committed";
      callbacks.onCommitted?.();
    },
    persistSession: () => events.push("save"),
    clamp: (value, min, max) => Math.max(min, Math.min(max, value))
  }, { get: (target, name) => name in target ? target[name] : noOp });
  // Use the production capability boundary even though unrelated fixture
  // services default to no-op. Undeclared dependencies must remain unavailable.
  const servicePort = (ports) => createLegacyPort(() => services, ports.services);
  const roots = createFocusedRootsController({ state, elements, services: servicePort(focusedRootsPorts) });
  Object.assign(services, {
    getFocusedRootContext: roots.getFocusedRootContext,
    getSelectedSingleCell: roots.getSelectedSingleCell,
    setCompareFocusedRootNodeIds: roots.setCompareFocusedRootNodeIds,
    replaceSingleFocusedRoots: (ids) => singleViewSession.dispatch({ type: "focus.replace",
      objectRefs: ids.map((id) => singleViewSession.objectRefForNode(state.fullGraph.nodes.find((node) => node.id === id))) })
  });
  services.setSelectedNode("cell:u");
  if (compare) {
    compareViewSessions.ensure("right");
    compareViewSessions.dispatch("left", { type: "selection.set", objectRef: compareViewSessions.objectRef("left", "cell", "u") });
  }
  const controls = createViewControlsController({ state, elements, services: servicePort(viewControlsPorts) });
  return { state, sessions, services, servicePort, elements, events, renders, roots, controls };
}

test("Single roots consume real command effects and repeated Set does not rebuild", () => {
  const h = controllerHarness();
  h.roots.setSelectedAsFocusedRoot();
  assert.deepEqual(h.state.focusedRootNodeIds, ["cell:u"]);
  assert.equal(h.events.filter((event) => event === "single").length, 1);
  h.roots.setSelectedAsFocusedRoot();
  assert.equal(h.events.filter((event) => event === "single").length, 1);
  h.roots.removeSelectedFromFocusedRoots();
  assert.deepEqual(h.state.focusedRootNodeIds, []);
  assert.equal(h.state.viewMode, "whole");
  assert.equal(h.events.filter((event) => event === "single").length, 2);
});

test("Compare synchronized roots merge both command results into one rebuild", () => {
  const h = controllerHarness(true);
  h.roots.setSelectedAsFocusedRoot();
  assert.deepEqual(h.state.compare.focusedRootNodeIds, { left: ["cell:u"], right: ["cell:u"] });
  assert.equal(h.events.filter((event) => event === "compare").length, 1);
  h.roots.setSelectedAsFocusedRoot();
  assert.equal(h.events.filter((event) => event === "compare").length, 1);
  h.roots.clearFocusedRoots();
  assert.deepEqual(h.state.compare.focusedRootNodeIds, { left: [], right: [] });
  assert.equal(h.events.filter((event) => event === "compare").length, 2);
});

test("depth and mode actions compute only for changed active queries", () => {
  const h = controllerHarness();
  h.elements.faninDepthInput.value = "5";
  h.controls.handleFocusedDepthChange();
  assert.equal(h.state.faninDepth, 5);
  assert.deepEqual(h.events, ["save"]);
  h.controls.setViewModeImpl("focused");
  assert.equal(h.events.filter((event) => event === "single").length, 1);
  h.controls.setViewModeImpl("focused");
  assert.equal(h.events.filter((event) => event === "single").length, 1);
  h.elements.faninDepthInput.value = "6";
  h.controls.handleFocusedDepthChange();
  h.controls.handleFocusedDepthChange();
  assert.equal(h.events.filter((event) => event === "single").length, 2);
});

test("startup Focused cancellation rejects its waiting operation and ignores later success", async () => {
  const h = controllerHarness();
  let callbacks;
  h.services.renderCurrentModuleGraph = (value) => { h.state.singleWorkspaceIdentity = null; callbacks = value; };
  const focus = createFocusNavigationController({ ...h, services: h.servicePort(focusNavigationPorts) });
  const pending = focus.focusStartupCell("u");
  const rejected = assert.rejects(pending, { name: "AbortError" });
  callbacks.onCancelled();
  callbacks.onRendered(h.state.graph);
  await rejected;
});

test("repeating startup Focused while its first graph is pending waits for the current operation", async () => {
  const h = controllerHarness();
  h.state.graph = { nodes: [], edges: [] };
  h.elements.mount.querySelector = () => null;
  const requests = [];
  const history = createViewHistoryTransaction({ commit() {} });
  h.services.renderCurrentModuleGraph = (options) => {
    h.state.singleWorkspaceIdentity = null;
    requests.at(-1)?.onCancelled();
    requests.push({ ...options, onRendered: history.bind(options.onRendered, options.onCancelled) });
  };
  const focus = createFocusNavigationController({ ...h, services: h.servicePort(focusNavigationPorts) });
  const first = history.run({ label: "first" }, () => focus.focusStartupCell("u"));
  const firstCancelled = assert.rejects(first, { name: "AbortError" });
  const second = history.run({ label: "second" }, () => focus.focusStartupCell("u"));
  let settled = false;
  second.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(requests.length, 2, "An unchanged requested query is not a committed workspace");
  assert.equal(settled, false);
  assert.equal(h.state.selectedNodeId, "cell:u", "The old empty graph must not clear the pending target");
  h.state.graph = h.state.fullGraph;
  h.state.singleWorkspaceIdentity = "committed";
  requests[1].onRendered(h.state.graph);
  await second;
  await firstCancelled;
  requests[0].onRendered({ nodes: [], edges: [] });
  assert.equal(h.state.selectedNodeId, "cell:u");
  assert.equal(settled, true);
});

test("repeated mode and depth requests replace pending work instead of reusing the old graph", () => {
  for (const compare of [false, true]) {
    const h = controllerHarness(compare);
    const requests = [];
    const schedule = (options) => {
      if (compare) h.state.compare.workspaceIdentity = null;
      else h.state.singleWorkspaceIdentity = null;
      requests.push(options);
    };
    if (compare) h.services.renderCompareGraphs = schedule;
    else h.services.renderCurrentModuleGraph = schedule;
    const mode = () => compare ? h.controls.setCompareViewModeImpl("focused") : h.controls.setViewModeImpl("focused");
    mode();
    mode();
    assert.equal(requests.length, 2);
    if (compare) h.state.compare.workspaceIdentity = "committed";
    else h.state.singleWorkspaceIdentity = "committed";
    h.elements.faninDepthInput.value = "7";
    h.controls.handleFocusedDepthChange();
    h.controls.handleFocusedDepthChange();
    assert.equal(requests.length, 4);
    if (compare) h.state.compare.workspaceIdentity = "committed";
    else h.state.singleWorkspaceIdentity = "committed";
    h.controls.handleFocusedDepthChange();
    assert.equal(requests.length, 4, "A completed matching query remains a no-op");
  }
});
