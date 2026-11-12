import assert from "node:assert/strict";
import test from "node:test";
import { createCompareWorkspaceController } from "../../src/app/compare_workspace_controller.js";
import { createWorkspaceRenderController } from "../../src/app/workspace_render_controller.js";
import { createRenderGeneration } from "../../src/render/renderGeneration.js";
import { createAppState } from "../../src/app/appState.js";
import { DEFAULT_LAYOUT_POLICY } from "../../src/layout/layoutPolicy.js";
import { createHistoryController } from "../../src/app/history_controller.js";
import { createViewHistoryEntry } from "../../src/app/viewHistory.js";
import { createInputController } from "../../src/app/input_controller.js";
import { createDocumentStore } from "../../src/application/document_store.js";
import { createGoldenController } from "../../src/app/golden_controller.js";
import { createSearchNavigationController } from "../../src/app/search_navigation_controller.js";
import { createViewControlsController } from "../../src/app/view_controls_controller.js";

test("Compare output change is exported and updates the selected output", () => {
  const state = { compare: { outputName: null, wholeRequested: true, focusedRootNodeIds: [] }, design: { modules: [] } };
  const calls = [];
  const controller = createCompareWorkspaceController({
    state,
    elements: { coneDepthInput: {} },
    services: {
      compareViewSessions: { dispatch: (...args) => calls.push(args) },
      renderStats: () => calls.push("stats"),
      recordViewHistory: () => calls.push("history")
    }
  });
  assert.equal(typeof controller.handleCompareOutputChange, "function");
  controller.handleCompareOutputChange({ target: { value: "y" } });
  assert.equal(state.compare.outputName, "y");
  assert.equal(state.compare.wholeRequested, false);
  assert.equal(calls.filter(Array.isArray).length, 2);
});

test("reapplying the current Compare pair preserves its query and viewport", () => {
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  const left = { name: "left", displayName: "Left" };
  const right = { name: "right", displayName: "Right" };
  state.design = { modules: [left, right] };
  state.compare.active = true;
  state.compare.leftModuleName = left.name;
  state.compare.rightModuleName = right.name;
  state.compare.outputName = "y";
  state.compare.wholeRequested = true;
  state.compare.transforms.left = { x: 10, y: 20, scale: 2 };
  const noOp = () => {};
  const element = { classList: { add: noOp, toggle: noOp }, setAttribute: noOp };
  const elements = new Proxy({
    leftModuleSelect: { value: left.name }, rightModuleSelect: { value: right.name }
  }, { get: (target, key) => key in target ? target[key] : element });
  const services = new Proxy({
    workspaceJobs: { cancelSession: noOp },
    setCompareTransform: (side, transform) => { state.compare.transforms[side] = transform; }
  }, { get: (target, key) => key in target ? target[key] : noOp });
  createCompareWorkspaceController({ state, elements, services }).applyCompareSelectionImpl({ deferRender: true });
  assert.equal(state.compare.outputName, "y");
  assert.equal(state.compare.wholeRequested, true);
  assert.deepEqual(state.compare.transforms.left, { x: 10, y: 20, scale: 2 });
});

test("Compare Whole explicitly bypasses Search-first and Focused accepts a selected net", () => {
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  state.compare.active = true;
  state.compare.selectedSide = "left";
  state.compare.selectedKind = "net";
  state.compare.selectedName = "n";
  const calls = [];
  const noOp = () => {};
  const services = new Proxy({
    runViewHistoryTransaction: (_metadata, operation) => operation(),
    getFocusedRootContext: () => ({ side: "left", roots: [], fullGraph: { nodes: [] } }),
    setCompareFocusedRootNodeIds: (side, roots) => { state.compare.focusedRootNodeIds[side] = roots; },
    renderCompareGraphs: () => calls.push("render")
  }, { get: (target, key) => key in target ? target[key] : noOp });
  const control = { classList: { toggle: noOp } };
  const elements = new Proxy({}, { get: (target, key) => target[key] ||= control });
  const controller = createViewControlsController({ state, elements, services });
  controller.setCompareViewModeImpl("focused");
  assert.deepEqual(state.compare.focusedRootNodeIds.left, ["net:n"]);
  state.compare.focusedRootNodeIds.right = ["cell:other"];
  state.compare.outputName = "y";
  controller.setCompareViewModeImpl("whole");
  assert.equal(state.compare.wholeRequested, true);
  assert.deepEqual(state.compare.focusedRootNodeIds, { left: [], right: [] });
  assert.equal(state.compare.outputName, null);
  assert.equal(calls.length, 2);
});

test("Compare headers keep A and B identities in Split and Stack and all statuses", () => {
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  const headers = { left: {}, right: {} };
  const elements = { compareMount: {
    querySelector: (selector) => headers[selector.includes('"left"') ? "left" : "right"],
    classList: { toggle() {} }
  } };
  const controller = createCompareWorkspaceController({ state, elements, services: {} });
  for (const layout of ["horizontal", "vertical"]) {
    state.compare.layout = layout;
    controller.applyCompareLayout();
    for (const status of ["ready", "loading", "failed", "cancelled"]) {
      controller.updateCompareSideStatus("left", { displayName: "Same module" }, status);
      controller.updateCompareSideStatus("right", { displayName: "Same module" }, status);
      const suffix = { ready: "", loading: " · Loading…", failed: " · Failed", cancelled: " · Cancelled" }[status];
      assert.equal(headers.left.textContent, `A · Same module${suffix}`);
      assert.equal(headers.right.textContent, `B · Same module${suffix}`);
    }
  }
});

test("entering Compare cancels Single computation before starting Compare work", () => {
  const left = { name: "left", displayName: "Left" };
  const right = { name: "right", displayName: "Right" };
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  state.currentModule = left;
  state.design = { modules: [left, right] };
  const cancelled = [];
  const noOp = () => {};
  const elements = {
    leftModuleSelect: { value: "left" }, rightModuleSelect: { value: "right" },
    comparePanel: {}, mount: {}, compareMount: { classList: { toggle: noOp } },
    compareButton: { classList: { add: noOp }, setAttribute: noOp }, compareLayoutSelect: {},
    syncCompareFocusInput: {}, coneDepthInput: {}
  };
  const services = new Proxy({
    workspaceJobs: { cancelSession: (id) => cancelled.push(id) },
    runViewHistoryTransaction: (_options, action) => action(),
    renderGeneration: { begin: () => { throw new Error("stop after view transition"); } }
  }, { get: (target, key) => key in target ? target[key] : noOp });
  const controller = createCompareWorkspaceController({ state, elements, services });
  assert.throws(() => controller.applyCompareSelectionImpl(), /stop after view transition/);
  assert.deepEqual(cancelled, ["single:primary"]);
  assert.equal(state.compare.active, true);
});

test("obsolete Single success and failure callbacks cannot affect an active Compare view", () => {
  const generation = createRenderGeneration();
  const state = {
    currentModule: { name: "top", displayName: "top" },
    design: { modules: [] },
    compare: { active: false }
  };
  let executionRequest;
  const failures = [];
  let cancellations = 0;
  const services = new Proxy({
    renderGeneration: generation,
    readCellLibrary: () => null,
    getCurrentLayoutProvider: () => ({ id: "simple", label: "Simple", executionMode: "async" }),
    workspaceExecution: { execute: (request) => { executionRequest = request; } },
    singleViewSession: { beginComputation: () => ({ sessionId: "single:primary" }) },
    logProcess() {}
  }, { get: (target, key) => key in target ? target[key] : (...args) => failures.push([key, args]) });
  const controller = createWorkspaceRenderController({ state, elements: { mount: {} }, services });
  controller.renderCurrentModuleGraph({ onCancelled: () => { cancellations += 1; } });
  state.compare.active = true;
  generation.begin();
  const graph = { nodes: [], edges: [] };
  executionRequest.onCommit([{ artifact: { value: { fullGraph: graph, autoGraph: graph, graph, scene: {} } } }]);
  executionRequest.onSettled([{ status: "committed" }]);
  executionRequest.onError(new Error("obsolete failure"));
  assert.equal(state.graph, undefined);
  assert.equal(cancellations, 2);
  assert.deepEqual(failures, []);
});

test("Compare history restores query depths and cancellation always releases history recording", () => {
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  const left = { name: "left", displayName: "Left" };
  const right = { name: "right", displayName: "Right" };
  state.currentModule = left;
  state.currentSource = "module left; endmodule";
  state.design = { modules: [left, right] };
  state.compare.active = true;
  state.compare.leftModuleName = "left";
  state.compare.rightModuleName = "right";
  state.coneDepth = state.faninDepth = state.fanoutDepth = 2;
  const entry = createViewHistoryEntry(state);
  state.coneDepth = state.faninDepth = state.fanoutDepth = 7;
  let renderOptions;
  const noOp = () => {};
  const elements = new Proxy({}, { get: (target, key) => target[key] ||= {} });
  const services = new Proxy({
    renderCompareGraphs: (options) => { renderOptions = options; },
    getCompareModule: (side) => side === "left" ? left : right
  }, { get: (target, key) => key in target ? target[key] : noOp });
  const controller = createHistoryController({ state, elements, services });
  controller.restoreViewHistoryEntry(entry);
  assert.deepEqual([state.coneDepth, state.faninDepth, state.fanoutDepth], [2, 2, 2]);
  assert.equal(state.restoringViewHistory, true);
  renderOptions.onCancelled();
  assert.equal(state.restoringViewHistory, false);
});

test("cross-pair Compare history restore defers intermediate work and starts one target render", () => {
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  const left = { name: "left", displayName: "Left" };
  const right = { name: "right", displayName: "Right" };
  state.currentModule = left;
  state.currentSource = "module left; endmodule";
  state.design = { modules: [left, right] };
  state.compare.active = true;
  state.compare.leftModuleName = "left";
  state.compare.rightModuleName = "right";
  const entry = createViewHistoryEntry(state);
  state.compare.active = false;
  state.compare.leftModuleName = null;
  state.compare.rightModuleName = null;
  let prepares = 0;
  let renders = 0;
  const noOp = () => {};
  const services = new Proxy({
    applyCompareSelection(options) {
      prepares += 1;
      assert.deepEqual(options, { historyMode: "restore", deferRender: true });
    },
    renderCompareGraphs: () => { renders += 1; },
    getCompareModule: (side) => side === "left" ? left : right
  }, { get: (target, key) => key in target ? target[key] : noOp });
  createHistoryController({
    state,
    elements: new Proxy({}, { get: (target, key) => target[key] ||= {} }),
    services
  }).restoreViewHistoryEntry(entry);
  assert.equal(prepares, 1);
  assert.equal(renders, 1);
});

test("Compare mount rejection records and exposes a default render failure", async () => {
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  const left = { name: "left", displayName: "Left", ports: [] };
  const right = { name: "right", displayName: "Right", ports: [] };
  state.design = { modules: [left, right] };
  state.compare.leftModuleName = "left";
  state.compare.rightModuleName = "right";
  const graph = { nodes: [], edges: [] };
  const messages = [];
  const statuses = [];
  const noOp = () => {};
  const elements = {
    compareMount: { querySelector: () => ({ textContent: "" }) },
    compareOutputSelect: { innerHTML: "", value: "" }, leftMount: {}, rightMount: {}
  };
  const services = new Proxy({
    renderGraphMount: (mount) => mount === elements.leftMount ? Promise.reject(new Error("left SVG failed")) : Promise.resolve({}),
    logProcess: (_level, _phase, message) => messages.push(message),
    setStatus: (message) => statuses.push(message),
    getCurrentLayoutProvider: () => ({ label: "Test" })
  }, { get: (target, key) => key in target ? target[key] : noOp });
  const controller = createCompareWorkspaceController({ state, elements, services });
  controller.commitCompareWorkspace({
    fullGraphs: { left: graph, right: graph }, autoGraphs: { left: graph, right: graph },
    graphs: { left: graph, right: graph }, scenes: { left: {}, right: {} }, analysis: {}
  }, left, right);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.compare.workspaceIdentity, null);
  assert.match(messages.at(-1), /Compare render failed: left SVG failed/);
  assert.match(statuses.at(-1), /Compare render failed: left SVG failed/);
});

test("Compare workspace identity is published only after both mounts complete", async () => {
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  const left = { name: "left", displayName: "Left", ports: [] };
  const right = { name: "right", displayName: "Right", ports: [] };
  state.design = { modules: [left, right] };
  state.compare.active = true;
  const graph = { nodes: [], edges: [] };
  const resolvers = [];
  const noOp = () => {};
  const elements = {
    compareMount: { querySelector: () => ({ textContent: "" }) },
    compareOutputSelect: {}, leftMount: {}, rightMount: {}
  };
  const services = new Proxy({
    renderGeneration: { current: () => ({ isCurrent: () => true }) },
    renderGraphMount: () => new Promise((resolve) => resolvers.push(resolve)),
    getCurrentLayoutProvider: () => ({ label: "Test" })
  }, { get: (target, key) => key in target ? target[key] : noOp });
  createCompareWorkspaceController({ state, elements, services }).commitCompareWorkspace({
    fullGraphs: { left: graph, right: graph }, autoGraphs: { left: graph, right: graph },
    graphs: { left: graph, right: graph }, scenes: { left: {}, right: {} }, analysis: {}
  }, left, right, { workspaceIdentity: "workspace:ready" });
  assert.equal(state.compare.workspaceIdentity, null);
  resolvers.forEach((resolve) => resolve({}));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.compare.workspaceIdentity, "workspace:ready");
});

test("an obsolete Compare history completion performs no selection or transform side effects", () => {
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  const left = { name: "left", displayName: "Left" };
  const right = { name: "right", displayName: "Right" };
  state.currentModule = left;
  state.currentSource = "module left; endmodule";
  state.design = { modules: [left, right] };
  state.compare.active = true;
  state.compare.leftModuleName = "left";
  state.compare.rightModuleName = "right";
  const firstEntry = createViewHistoryEntry(state);
  const secondEntry = createViewHistoryEntry(state);
  secondEntry.faninDepth += 1;
  const renders = [];
  let transforms = 0;
  let selections = 0;
  const noOp = () => {};
  const services = new Proxy({
    renderCompareGraphs: (options) => renders.push(options),
    getCompareModule: (side) => side === "left" ? left : right,
    applyCompareTransforms: () => { transforms += 1; },
    selectCompareObject: () => { selections += 1; }
  }, { get: (target, key) => key in target ? target[key] : noOp });
  const controller = createHistoryController({
    state,
    elements: new Proxy({}, { get: (target, key) => target[key] ||= {} }),
    services
  });
  controller.restoreViewHistoryEntry(firstEntry);
  controller.restoreViewHistoryEntry(secondEntry);
  renders[0].onCommitted();
  assert.equal(transforms, 0);
  assert.equal(selections, 0);
  assert.equal(state.restoringViewHistory, true);
  renders[1].onCommitted();
  assert.equal(transforms, 1);
  assert.equal(state.restoringViewHistory, false);
});

test("cancelled Single history render releases the restore lifecycle", () => {
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  state.currentModule = { name: "top", displayName: "Top" };
  state.currentSource = "module top; endmodule";
  state.design = { modules: [state.currentModule] };
  state.graph = { nodes: [], edges: [] };
  const entry = createViewHistoryEntry(state);
  entry.faninDepth = state.faninDepth + 1;
  let renderOptions;
  const noOp = () => {};
  const services = new Proxy({
    renderCurrentModuleGraph: (options) => { renderOptions = options; }
  }, { get: (target, key) => key in target ? target[key] : noOp });
  const elements = {
    mount: {}, moduleBackButton: {}, moduleForwardButton: {},
    coneDepthInput: {}, faninDepthInput: {}, fanoutDepthInput: {}
  };
  const controller = createHistoryController({
    state, elements, services
  });
  controller.restoreViewHistoryEntry(entry);
  assert.equal(elements.faninDepthInput.value, String(entry.faninDepth));
  assert.equal(elements.fanoutDepthInput.value, String(entry.fanoutDepth));
  assert.equal(state.restoringViewHistory, true);
  renderOptions.onCancelled();
  assert.equal(state.restoringViewHistory, false);
});

test("exiting Compare rebuilds a Single workspace that was cancelled on entry", () => {
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  state.currentModule = { name: "top", displayName: "Top" };
  state.compare.active = true;
  state.compare.singleWorkspaceInvalidated = true;
  let renders = 0;
  const noOp = () => {};
  const elements = {
    comparePanel: {}, compareMount: {}, mount: {},
    compareButton: { classList: { remove: noOp }, setAttribute: noOp }
  };
  const services = new Proxy({
    workspaceJobs: { cancelSession: noOp }, renderGeneration: { begin: noOp },
    renderCurrentModuleGraph: () => renders++
  }, { get: (target, key) => key in target ? target[key] : noOp });
  createCompareWorkspaceController({ state, elements, services }).exitCompareView();
  assert.equal(renders, 1);
  assert.equal(state.compare.singleWorkspaceInvalidated, true);
});

test("design restore applies state before one final render and preserves its completion callback", () => {
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  const elements = {
    searchInput: {}, layoutProviderSelect: {}, coneDepthInput: {}, faninDepthInput: {}, fanoutDepthInput: {}
  };
  let selectOptions;
  let renderOptions;
  let completions = 0;
  const failure = () => {};
  const cancellation = () => {};
  let renders = 0;
  const noOp = () => {};
  const services = new Proxy({
    documents: createDocumentStore(),
    viewSessions: { closeByDocument: noOp },
    workspaceJobs: { cancelDocument: noOp },
    netlistFeature: { buildSearchIndex: () => [] },
    cloneObjectRefs: (refs) => [...(refs || [])],
    selectModule(name, options) {
      selectOptions = options;
      state.currentModule = state.design.modules.find((module) => module.name === name);
      state.viewMode = "whole";
    },
    renderCurrentModuleGraph(options) {
      renders += 1;
      renderOptions = options;
    }
  }, { get: (target, key) => key in target ? target[key] : noOp });
  const controller = createInputController({ state, elements, services });
  controller.loadDesign("module top(input a, output y); BUF u (.A(a), .Y(y)); endmodule", "restored.v", {
    moduleName: "top", viewMode: "focused", focusedRootNodeIds: ["cell:u"],
    coneDepth: 4, faninDepth: 5, fanoutDepth: 6, onRendered: () => completions++,
    onFailed: failure, onCancelled: cancellation
  });
  assert.equal(selectOptions.deferRender, true);
  assert.equal(renders, 1);
  assert.equal(state.viewMode, "focused");
  assert.deepEqual([state.coneDepth, state.faninDepth, state.fanoutDepth], [4, 5, 6]);
  assert.equal(typeof renderOptions.onFailed, "function");
  assert.equal(typeof renderOptions.onCancelled, "function");
  renderOptions.onRendered?.({ nodes: [], edges: [] });
  assert.equal(completions, 1);
});

test("loading a design exits and clears an active Compare workspace", async () => {
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  state.compare.active = true;
  state.compare.leftModuleName = "old-left";
  state.compare.rightModuleName = "old-right";
  let exited = 0;
  const noOp = () => {};
  const services = new Proxy({
    documents: createDocumentStore(), viewSessions: { closeByDocument: noOp }, workspaceJobs: { cancelDocument: noOp },
    netlistFeature: { buildSearchIndex: () => [] }, cloneObjectRefs: () => [],
    exitCompareView: (options) => { exited += 1; assert.equal(options.deferSingleRender, true); },
    selectModule(name) { state.currentModule = state.design.modules.find((module) => module.name === name); },
    renderCurrentModuleGraph: (options) => options.onRendered({ nodes: [], edges: [] })
  }, { get: (target, key) => key in target ? target[key] : noOp });
  await createInputController({
    state, elements: { coneDepthInput: {}, faninDepthInput: {}, fanoutDepthInput: {} }, services
  }).loadDesign("module next; endmodule", "next.v");
  assert.equal(exited, 1);
  assert.equal(state.compare.active, false);
  assert.equal(state.compare.leftModuleName, null);
  assert.equal(state.currentModule.name, "next");
});

test("startup display module name resolves to its canonical escaped module", async () => {
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  let selected;
  const noOp = () => {};
  const services = new Proxy({
    documents: createDocumentStore(), viewSessions: { closeByDocument: noOp }, workspaceJobs: { cancelDocument: noOp },
    netlistFeature: { buildSearchIndex: () => [] }, cloneObjectRefs: () => [],
    selectModule(name) { selected = name; state.currentModule = state.design.modules.find((module) => module.name === name); },
    renderCurrentModuleGraph: (options) => options.onRendered({ nodes: [], edges: [] })
  }, { get: (target, key) => key in target ? target[key] : noOp });
  await createInputController({
    state, elements: { coneDepthInput: {}, faninDepthInput: {}, fanoutDepthInput: {} }, services
  }).loadDesign("module first; endmodule module \\foo.bar (); endmodule", "escaped.v", { moduleName: "\\foo.bar" });
  assert.equal(selected, "foo.bar");
});

test("startup ensureDesign rejects when its final render fails or is cancelled", async () => {
  for (const outcome of ["failed", "cancelled"]) {
    const state = createAppState(DEFAULT_LAYOUT_POLICY);
    const elements = { searchInput: {}, layoutProviderSelect: {}, coneDepthInput: {}, faninDepthInput: {}, fanoutDepthInput: {} };
    let renderOptions;
    const noOp = () => {};
    const services = new Proxy({
      documents: createDocumentStore(), viewSessions: { closeByDocument: noOp }, workspaceJobs: { cancelDocument: noOp },
      netlistFeature: { buildSearchIndex: () => [] }, cloneObjectRefs: (refs) => [...(refs || [])],
      selectModule(name) { state.currentModule = state.design.modules.find((module) => module.name === name); },
      renderCurrentModuleGraph(options) { renderOptions = options; }
    }, { get: (target, key) => key in target ? target[key] : noOp });
    const pending = createInputController({ state, elements, services }).createStartupHandlers().ensureDesign();
    if (outcome === "failed") renderOptions.onFailed(new Error("layout failed"));
    else renderOptions.onCancelled();
    await assert.rejects(pending, outcome === "failed" ? /layout failed/ : /cancelled/);
  }
});

test("timing quick input resolves only after the refreshed workspace is mounted", async () => {
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  state.currentModule = { name: "top" };
  let renderOptions;
  const noOp = () => {};
  const services = new Proxy({
    rerenderPreservingView: (_selectedNodeId, options) => { renderOptions = options; }
  }, { get: (target, key) => key in target ? target[key] : noOp });
  const controller = createInputController({ state, elements: {}, services });
  let settled = false;
  const pending = controller.loadQuickInputText(
    "@module top\npoint at rt slack\nu0/A 1.0 0.1 -0.2",
    { kind: "timing", label: "timing.log" }
  ).then((kind) => { settled = true; return kind; });
  await Promise.resolve();
  assert.equal(settled, false);
  renderOptions.onRendered({ nodes: [], edges: [] });
  assert.equal(await pending, "timing");
});

test("startup rejects an explicit missing module before scheduling layout", () => {
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  const elements = { searchInput: {}, layoutProviderSelect: {}, coneDepthInput: {}, faninDepthInput: {}, fanoutDepthInput: {} };
  let renders = 0;
  const noOp = () => {};
  const services = new Proxy({
    documents: createDocumentStore(), viewSessions: { closeByDocument: noOp }, workspaceJobs: { cancelDocument: noOp },
    netlistFeature: { buildSearchIndex: () => [] }, cloneObjectRefs: (refs) => [...(refs || [])],
    renderCurrentModuleGraph: () => { renders += 1; }
  }, { get: (target, key) => key in target ? target[key] : noOp });
  const handler = createInputController({ state, elements, services }).createStartupHandlers();
  assert.throws(() => handler.loadNetlist({ text: "module top; endmodule", name: "design.v" }, { module: "missing" }), /module not found/);
  assert.equal(renders, 0);
});

test("session persistence retains diagnostics, coalesces a failure streak, and reports recovery", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const failure = new Error("quota", { cause: new Error("storage full") });
  let failing = true;
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true, get: () => ({ setItem() { if (failing) throw failure; } })
  });
  try {
    const state = createAppState(DEFAULT_LAYOUT_POLICY);
    state.currentSource = "module top; endmodule";
    state.currentModule = { name: "top" };
    const statuses = [];
    const logs = [];
    const noOp = () => {};
    const services = new Proxy({
      viewHistoryTransactions: { capture: () => false },
      setStatus: (message) => statuses.push(message),
      logProcess: (level, phase, message, details) => logs.push({ level, phase, message, details })
    }, { get: (target, key) => key in target ? target[key] : noOp });
    const controller = createHistoryController({
      state, elements: { moduleBackButton: {}, moduleForwardButton: {} }, services
    });
    controller.persistSession();
    await new Promise((resolve) => setTimeout(resolve, 180));
    controller.persistSession();
    await new Promise((resolve) => setTimeout(resolve, 180));
    assert.equal(statuses.filter((message) => message.includes("Session save failed")).length, 1);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].phase, "persistence");
    assert.equal(logs[0].details.operation, "save-session");
    assert.equal(logs[0].details.moduleName, "top");
    assert.strictEqual(logs[0].details.error, failure);
    failing = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      controller.persistSession();
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
    assert.equal(logs.length, 2, "one recovery log, not a log for every successful autosave");
    assert.equal(logs[1].level, "info");
    assert.match(logs[1].message, /recovered/);
    failing = true;
    controller.persistSession();
    await new Promise((resolve) => setTimeout(resolve, 180));
    assert.equal(logs.length, 3, "a later failure starts a new streak");
    assert.equal(logs[2].level, "error");
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "sessionStorage", descriptor);
    else delete globalThis.sessionStorage;
  }
});

test("SVG export is disabled and guarded while Compare is active", () => {
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  state.compare.active = true;
  state.currentModule = { name: "top" };
  state.graph = { nodes: [], edges: [] };
  let downloads = 0;
  let status;
  const controller = createGoldenController({ state, elements: {}, services: {
    browserDownload: { text: () => downloads++ }, setStatus: (value) => { status = value; }
  } });
  controller.exportCurrentSvg();
  assert.equal(downloads, 0);
  assert.match(status, /Exit Compare/);
});

test("Single exports stay disabled until the current workspace mount completes", () => {
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  state.currentModule = { name: "top" };
  state.graph = { nodes: [], edges: [] };
  state.scene = { items: [] };
  let downloads = 0;
  const statuses = [];
  const controller = createGoldenController({ state, elements: {}, services: {
    browserDownload: { text: () => downloads++, json: () => downloads++ },
    setStatus: (message) => statuses.push(message)
  } });
  controller.exportCurrentSvg();
  controller.saveLayoutGolden();
  assert.equal(downloads, 0);
  assert.equal(statuses.filter((message) => message.includes("Wait for the current Single workspace")).length, 2);
});

test("activating a visible port search result selects its positioned node", () => {
  const port = { id: "input:a", kind: "input", ref: { name: "a" }, x: 10, y: 20, width: 40, height: 20 };
  const state = { currentModule: { name: "top" }, graph: { nodes: [port], edges: [] }, fullGraph: { nodes: [port], edges: [] }, transform: { scale: 1 } };
  let selected;
  const controller = createSearchNavigationController({ state, elements: { searchResults: {} }, services: {
    setSelectedNode: (id) => { selected = id; }, setStatus() {}, getSvg: () => null
  } });
  controller.activateSearchResult({ moduleName: "top", kind: "port", label: "a", target: { kind: "port", name: "a", direction: "input" } });
  assert.equal(selected, "input:a");
});

test("activating an unavailable port search result preserves the current selection", () => {
  const state = {
    currentModule: { name: "top" }, graph: { nodes: [], edges: [] },
    fullGraph: { nodes: [{ id: "input:a", kind: "input", ref: { name: "a" } }], edges: [] }
  };
  let selected = "cell:keep";
  let status = "";
  const controller = createSearchNavigationController({ state, elements: { searchResults: {} }, services: {
    setSelectedNode: (id) => { selected = id; }, setStatus: (message) => { status = message; }
  } });
  controller.activateSearchResult({ moduleName: "top", kind: "port", label: "a", target: { kind: "port", name: "a", direction: "input" } });
  assert.equal(selected, "cell:keep");
  assert.match(status, /unavailable/);
});
