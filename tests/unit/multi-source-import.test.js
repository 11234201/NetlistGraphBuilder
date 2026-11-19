import assert from "node:assert/strict";
import test from "node:test";
import { mergeNetlistSources } from "../../src/domains/netlist/design_merge.js";
import { buildModuleHierarchy } from "../../src/domains/netlist/module_hierarchy.js";
import { mergeImportedTiming } from "../../src/domains/netlist/timing_import.js";
import { parseTimingLog, mergeTimingDatasets } from "../../src/timing/timingParser.js";
import { annotateGraphTiming } from "../../src/timing/timingAnnotation.js";
import { buildSchematicGraph } from "../../src/netlist/graph.js";
import { inspectGraphNode } from "../../src/analysis/graphInspector.js";
import { buildModuleConnectivityTemplates } from "../../src/domains/netlist/hierarchy_connectivity.js";
import { importDesignSource } from "../../src/app/designInput.js";
import { recommendModulePair } from "../../src/analysis/moduleCompare.js";
import { createAppState } from "../../src/app/appState.js";
import { DEFAULT_LAYOUT_POLICY } from "../../src/layout/layoutPolicy.js";
import { createInputController } from "../../src/app/input_controller.js";
import { prepareCompareWorkspace } from "../../src/app/compareWorkspace.js";
import { createDocumentStore } from "../../src/application/document_store.js";
import { createImportRequests } from "../../src/application/import_requests.js";
import { createQuickInputController } from "../../src/ui/quick_input_controller.js";
import { createProcessLog } from "../../src/app/processLog.js";
import { createSessionSnapshot } from "../../src/app/sessionState.js";
import { sessionPersistencePorts } from "../../src/app/session_persistence_controller.js";
import { encodeSessionSnapshot, decodeSessionSnapshot } from "../../src/persistence/session_codec.js";

function createHarnessState() {
  return createAppState(DEFAULT_LAYOUT_POLICY);
}

function createInputHarness(state) {
  const events = [];
  const log = createProcessLog();
  const elements = {
    searchInput: { value: "" },
    coneDepthInput: { value: "" },
    faninDepthInput: { value: "" },
    fanoutDepthInput: { value: "" }
  };
  const noOp = () => {};
  const services = new Proxy({
    documents: createDocumentStore(),
    importRequests: createImportRequests(),
    viewSessions: { closeByDocument: noOp },
    workspaceJobs: { cancelDocument: noOp },
    netlistFeature: { buildSearchIndex: () => [] },
    singleViewSession: { resetNavigation: noOp, importQuery: noOp, importNavigation: noOp },
    compareViewSessions: { resetState: noOp },
    selectModule(name) {
      state.currentModule = state.design.modules.find((item) => item.name === name) || null;
    },
    renderCurrentModuleGraph(options) {
      options?.onRendered?.({ nodes: [], edges: [] });
    },
    rerenderPreservingView(_selectedNodeId, options) {
      options?.onRendered?.({ nodes: [], edges: [] });
    },
    renderCompareGraphs(options) {
      options?.onCommitted?.({ left: { nodes: [] }, right: { nodes: [] } });
    },
    logProcess(level, phase, message, details) {
      const entry = log.append({ level, phase, message, details });
      events.push(entry);
      return entry;
    }
  }, { get: (target, key) => (key in target ? target[key] : noOp) });

  return {
    events,
    elements,
    services,
    controller: createInputController({ state, elements, services })
  };
}

function makeQuickElements() {
  const eventTarget = () => {
    const listeners = {};
    return { listeners, addEventListener(type, handler) { listeners[type] = handler; }, value: "", focus() {}, setSelectionRange() {} };
  };
  const controls = Object.fromEntries(["text-submit", "text-status", "aig-input-options", "aig-input-view", "bulk-text-expand", "bulk-text-clear"]
    .map((name) => [`[data-${name}]`, { ...eventTarget(), hidden: true, disabled: false }]));
  return {
    netlistInput: eventTarget(),
    addDesignInput: eventTarget(),
    timingInput: eventTarget(),
    addTimingInput: eventTarget(),
    goldenInput: eventTarget(),
    libertyInput: eventTarget(),
    compareLeftNetlistInput: eventTarget(),
    compareRightNetlistInput: eventTarget(),
    compareLeftTimingInput: eventTarget(),
    compareRightTimingInput: eventTarget(),
    pasteNetlistButton: eventTarget(),
    pasteTimingButton: eventTarget(),
    pasteAigButton: eventTarget(),
    compareLeftPasteNetlistButton: eventTarget(),
    compareRightPasteNetlistButton: eventTarget(),
    compareLeftPasteTimingButton: eventTarget(),
    compareRightPasteTimingButton: eventTarget(),
    closeTextButton: eventTarget(),
    cancelTextButton: eventTarget(),
    textForm: { ...eventTarget(), requestSubmit() {}, querySelector: (selector) => controls[selector] },
    textInput: eventTarget(),
    textTitle: {},
    textDescription: {},
    textDialog: { ...eventTarget(), open: false, showModal() { this.open = true; }, close() { this.open = false; } },
    dropOverlay: { setAttribute() {} },
    body: { classList: { add() {}, remove() {} } }
  };
}

test("mergeNetlistSources keeps unique modules intact and disambiguates colliding names with filename", () => {
  const beforeSource = `
    module leaf(input a, output y); BUF u_b(.A(a), .Y(y)); endmodule
    module tc(input in0, output out0); leaf sub(.a(in0), .y(out0)); endmodule
    module unique_a(input a, output y); INV u0(.A(a), .Y(y)); endmodule
  `;
  const afterSource = `
    module leaf(input a, output y); INV u_a(.A(a), .Y(y)); endmodule
    module tc(input in0, output out0); leaf sub(.a(in0), .y(out0)); endmodule
    module unique_b(input a, output y); BUF u1(.A(a), .Y(y)); endmodule
  `;

  const envelope = mergeNetlistSources([
    { name: "dir1/before.v", text: beforeSource },
    { name: "dir2/after.v", text: afterSource }
  ]);
  const modules = envelope.model.modules;
  assert.equal(modules.length, 6);

  const uniqueA = modules.find((m) => m.name === "unique_a");
  const uniqueB = modules.find((m) => m.name === "unique_b");
  assert.equal(uniqueA.displayName, "unique_a");
  assert.equal(uniqueB.displayName, "unique_b");

  const tcBefore = modules.find((m) => m.name === "tc [before.v]");
  const tcAfter = modules.find((m) => m.name === "tc [after.v]");
  assert.ok(tcBefore && tcAfter);
  assert.equal(tcBefore.originalName, "tc");
  assert.equal(tcAfter.originalName, "tc");
  assert.equal(tcBefore.sourceFile, "before.v");
  assert.equal(tcAfter.sourceFile, "after.v");

  const hierarchy = buildModuleHierarchy(envelope.model);
  const tcBeforeNode = hierarchy.find((n) => n.moduleName === "tc [before.v]");
  const tcAfterNode = hierarchy.find((n) => n.moduleName === "tc [after.v]");
  assert.equal(tcBeforeNode.children[0].moduleName, "leaf [before.v]");
  assert.equal(tcAfterNode.children[0].moduleName, "leaf [after.v]");

  const tcBeforeGraph = buildSchematicGraph(tcBefore, { moduleLibrary: modules });
  const tcAfterGraph = buildSchematicGraph(tcAfter, { moduleLibrary: modules });
  assert.equal(tcBeforeGraph.timingModuleName, "tc");
  assert.equal(tcBeforeGraph.nodes.find((n) => n.id === "cell:sub").referencedModuleName, "leaf [before.v]");
  assert.equal(tcAfterGraph.nodes.find((n) => n.id === "cell:sub").referencedModuleName, "leaf [after.v]");

  assert.equal(recommendModulePair(modules, "tc [before.v]")?.name, "tc [after.v]");
});

test("mergeTimingDatasets and mergeImportedTiming isolate scopes across files and preserve module matching", () => {
  const dsA = parseTimingLog("@module tc\npoint at rt slack\nsub/A 0.5 0.6 -0.25");
  const dsB = parseTimingLog("@module unique_b\npoint at rt slack\nu1/A 0.4 0.3 0.10");
  const merged = mergeImportedTiming(dsA, dsB);
  assert.equal(merged.module, null);
  assert.equal(merged.scopeCount, 2);

  const envelope = mergeNetlistSources([
    { name: "before.v", text: "module tc(input a, output z); BUF sub(.A(a), .Y(z)); endmodule" },
    { name: "after.v", text: "module unique_b(input a, output z); BUF u1(.A(a), .Y(z)); endmodule" }
  ]);
  const graphTc = annotateGraphTiming(buildSchematicGraph(envelope.model.modules[0]), merged);
  const graphUniqueB = annotateGraphTiming(buildSchematicGraph(envelope.model.modules[1]), merged);
  assert.equal(graphTc.nodes.find((n) => n.id === "cell:sub").timing.pins.A.slack, -0.25);
  assert.equal(graphUniqueB.nodes.find((n) => n.id === "cell:u1").timing.pins.A.slack, 0.1);

  assert.equal(mergeTimingDatasets([dsA]).module, "tc");
});

test("input controller appends designs, merges in Compare mode per side, isolates timing, and logs merge failures safely", async () => {
  const state = createHarnessState();
  const { controller, events } = createInputHarness(state);

  await controller.loadDesign("module tc(input a, output z); BUF u0(.A(a), .Y(z)); endmodule", "before.v");
  await controller.loadTimingText("@module tc\npoint at rt slack\nu0/A 1.0 0.5 -0.4", "shared.rpt");
  assert.equal(state.timing.instanceCount, 1);

  await controller.loadQuickInputText("module tc(input a, output z); INV u0(.A(a), .Y(z)); endmodule", {
    kind: "netlist", label: "after.v", append: true
  });
  assert.equal(state.design.modules.length, 2);
  assert.equal(state.currentModule.name, "tc [before.v]");
  assert.equal(state.timing.instanceCount, 1);

  state.compare.active = true;
  state.compare.leftModuleName = "tc [before.v]";
  state.compare.rightModuleName = "tc [after.v]";
  await controller.loadQuickInputText("module tc_v3(input a, output z); BUF u2(.A(a), .Y(z)); endmodule", {
    kind: "netlist", label: "v3.v", compareSide: "right"
  });
  assert.equal(state.compare.leftModuleName, "tc [before.v]");
  assert.equal(state.compare.rightModuleName, "tc_v3");
  assert.equal(state.design.modules.length, 3);

  await controller.loadQuickInputText("@module tc\npoint at rt slack\nu0/A 1.0 0.5 -0.9", {
    kind: "timing", label: "left.rpt", compareSide: "left"
  });
  await controller.loadQuickInputText("@module tc_v3\npoint at rt slack\nu2/A 1.0 0.5 0.2", {
    kind: "timing", label: "right.rpt", compareSide: "right"
  });
  const prepared = prepareCompareWorkspace({
    leftModule: state.design.modules.find((m) => m.name === state.compare.leftModuleName),
    rightModule: state.design.modules.find((m) => m.name === state.compare.rightModuleName),
    timing: state.timing,
    sideTiming: state.compare.sideTiming
  });
  assert.equal(prepared.fullGraphs.left.nodes.find((n) => n.id === "cell:u0").timing.pins.A.slack, -0.9);
  assert.equal(prepared.fullGraphs.right.nodes.find((n) => n.id === "cell:u2").timing.pins.A.slack, 0.2);

  await assert.rejects(
    async () => controller.loadQuickInputText("not valid verilog", { kind: "netlist", label: "broken.v", append: true }),
    /No module declarations/
  );
  assert.equal(state.design.modules.length, 3);
  const parseErr = events.find((e) => e.details?.code === "netlist.merge-parse-failed");
  assert.ok(parseErr?.details?.error?.stack);
});

test("quick input controller routes multi-file selections, Add inputs, and Compare A/B actions", async () => {
  const elements = makeQuickElements();
  const windowTarget = {
    listeners: {},
    addEventListener(type, handler) { this.listeners[type] = handler; }
  };
  const calls = [];
  const controller = createQuickInputController({
    elements,
    windowTarget,
    importRequests: createImportRequests(),
    setStatus() {},
    schedule: (run) => run(),
    loadText: async (text, options) => { calls.push({ text, ...options }); }
  });

  await controller.loadFiles([
    { name: "first.v", text: async () => "module first(); endmodule" },
    { name: "second.v", text: async () => "module second(); endmodule" }
  ]);
  assert.equal(calls[0].append, undefined);
  assert.equal(calls[1].append, true);

  await elements.addDesignInput.listeners.change({
    target: { files: [{ name: "extra.v", text: async () => "module extra(); endmodule" }], value: "extra.v" }
  });
  assert.equal(calls[2].append, true);
  assert.equal(calls[2].kind, "netlist");

  elements.compareRightPasteTimingButton.listeners.click();
  assert.match(elements.textTitle.textContent, /for B$/);
  elements.textInput.value = "point at rt slack\nu0/A 1 2 0.1";
  await elements.textForm.listeners.submit({ preventDefault() {} });
  assert.equal(calls[3].kind, "timing");
  assert.equal(calls[3].compareSide, "right");
});

test("multi-file session round-trip, malformed sourceFiles restore guard, batch failure reset, and Compare timing selection refresh", async () => {
  assert.ok(sessionPersistencePorts.state.includes("sourceFiles"));

  const state = createHarnessState();
  const { controller } = createInputHarness(state);
  await controller.loadDesign("module m1(input a, output y); BUF u0(.A(a), .Y(y)); endmodule", "one.v");
  await controller.loadQuickInputText("module m2(input a, output y); INV u1(.A(a), .Y(y)); endmodule", {
    kind: "netlist", label: "two.v", append: true
  });
  const encoded = encodeSessionSnapshot(createSessionSnapshot(state));
  const decoded = decodeSessionSnapshot(encoded);
  assert.equal(decoded.sourceFiles.length, 2);

  await controller.loadDesign("module fallback_m(input a, output y); BUF u2(.A(a), .Y(y)); endmodule", "clean.v", {
    sourceFiles: [null, { name: "bad" }, { name: "clean.v", text: "module fallback_m(input a, output y); BUF u2(.A(a), .Y(y)); endmodule" }]
  });
  assert.equal(state.design.modules[0].name, "fallback_m");

  let refreshedCount = 0;
  const compareState = createHarnessState();
  compareState.compare.active = true;
  compareState.compare.leftModuleName = "a";
  compareState.compare.rightModuleName = "b";
  const cmpController = createInputController({
    state: compareState,
    elements: { searchInput: { value: "" }, coneDepthInput: { value: "" }, faninDepthInput: { value: "" }, fanoutDepthInput: { value: "" } },
    services: new Proxy({
      renderCompareGraphs: (opts) => opts?.onCommitted?.({ left: { nodes: [] }, right: { nodes: [] } })
    }, { get: (t, k) => (k in t ? t[k] : () => {}) }),
    compareSideActions: {
      setCompareSideTiming: (side, timing, label) => {
        compareState.compare.sideTiming[side] = timing;
        compareState.compare.sideTimingLabels[side] = label;
        return timing;
      },
      refreshCompareSelection: () => { refreshedCount += 1; }
    }
  });
  await cmpController.loadTimingText("@module a\npoint at rt slack\nu0/A 1 0.5 0.1", "a.rpt", { compareSide: "left" });
  await cmpController.loadTimingText("@module b\npoint at rt slack\nu1/A 1 0.5 0.2", "b.rpt");
  assert.equal(refreshedCount, 2);

  const elements = makeQuickElements();
  const batchCalls = [];
  const quick = createQuickInputController({
    elements,
    windowTarget: { listeners: {}, addEventListener(t, h) { this.listeners[t] = h; } },
    importRequests: createImportRequests(),
    setStatus() {},
    schedule: (run) => run(),
    loadText: async (_text, options) => {
      batchCalls.push(options);
      if (options.label === "broken.v") throw new Error("parse error");
    }
  });
  await quick.loadFiles([
    { name: "broken.v", text: async () => "not verilog" },
    { name: "good.v", text: async () => "module good(); endmodule" }
  ]);
  assert.equal(batchCalls.length, 2);
  assert.equal(batchCalls[1].label, "good.v");
  assert.equal(batchCalls[1].append, undefined);
});

test("single-source duplicate module names disambiguate cleanly and multi-file 2-level hierarchy resolves templates and parent occurrences", () => {
  const singleText = `
    module tc(input a, output z); BUF g1(.A(a), .Y(z)); endmodule
    module helper(input a, output z); INV g2(.A(a), .Y(z)); endmodule
    module tc(input a, output z); INV g3(.A(a), .Y(z)); endmodule
  `;
  const singleDoc = importDesignSource(singleText, { name: "two_in_one.v" });
  const names = singleDoc.model.modules.map((m) => [m.name, m.originalName]);
  assert.deepEqual(names, [["tc #1", "tc"], ["helper", undefined], ["tc #2", "tc"]]);
  assert.equal(recommendModulePair(singleDoc.model.modules, "tc #1")?.name, "tc #2");

  const makeDesign = (tag) => `
    // module: leaf, type = attr, version = "${tag}"
    module leaf(input d, output q); BUF u_leaf_${tag}(.A(d), .Y(q)); endmodule
    module mid(input x, output y); leaf u_leaf(.d(x), .q(y)); endmodule
    module top(input in0, output out0); mid u_mid(.x(in0), .y(out0)); endmodule
  `;
  const merged = mergeNetlistSources([
    { name: "before.v", text: makeDesign("b") },
    { name: "after.v", text: makeDesign("a") }
  ]);
  const templates = buildModuleConnectivityTemplates(merged.model);
  assert.equal(templates.get("mid [before.v]").cells[0].childModuleName, "leaf [before.v]");
  assert.equal(templates.get("mid [after.v]").cells[0].childModuleName, "leaf [after.v]");

  const midBefore = merged.model.modules.find((m) => m.name === "mid [before.v]");
  const midBeforeGraph = buildSchematicGraph(midBefore, { moduleLibrary: merged.model.modules });
  const hinstInspection = inspectGraphNode(midBeforeGraph, midBeforeGraph.nodes.find((n) => n.id === "cell:u_leaf"));
  assert.equal(hinstInspection.referencedModuleDisplayName, "leaf [before.v]");

  const leafBefore = merged.model.modules.find((m) => m.name === "leaf [before.v]");
  const leafBeforeGraph = buildSchematicGraph(leafBefore, { moduleLibrary: merged.model.modules });
  const leafGateInspection = inspectGraphNode(
    leafBeforeGraph,
    leafBeforeGraph.nodes.find((n) => n.id === "cell:u_leaf_b"),
    {
      hierarchyContext: {
        design: merged.model,
        currentModule: leafBefore,
        rootModuleName: "top [before.v]",
        occurrencePath: ["u_mid", "u_leaf"]
      }
    }
  );
  assert.ok(leafGateInspection.hierarchyConnections.some((conn) => conn.target?.moduleName === "mid [before.v]"));
});
