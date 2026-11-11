import assert from "node:assert/strict";
import test from "node:test";
import { createProcessLog } from "../../src/app/processLog.js";
import { createPresentationController } from "../../src/app/presentation_controller.js";
import { createCellConfigController } from "../../src/app/cell_config_controller.js";
import { createInputController } from "../../src/app/input_controller.js";
import { createAppState } from "../../src/app/appState.js";
import { DEFAULT_LAYOUT_POLICY } from "../../src/layout/layoutPolicy.js";
import { createHistoryController } from "../../src/app/history_controller.js";
import { createViewHistoryEntry } from "../../src/app/viewHistory.js";
import { createSingleWorkspaceIdentity, createCompareWorkspaceIdentity } from "../../src/app/workspace_identity.js";

function logging() {
  const log = createProcessLog(), statuses = [];
  return { log, statuses, services: {
    setStatus: (message) => statuses.push(message),
    logProcess: (level, phase, message, details) => log.append({ level, phase, message, details })
  } };
}

for (const compare of [false, true]) {
  for (const failure of [new Error("cannot mount scene"), null, "plain rejection"]) {
    test(`presentation failures include render context and diagnostics; compare=${compare}; reason=${String(failure)}`, async () => {
      const state = createAppState(DEFAULT_LAYOUT_POLICY);
      const graph = { nodes: [], edges: [], width: 0, height: 0 };
      state.compare.active = compare;
      state.graph = graph;
      state.compare.graphs = { left: graph, right: graph };
      const { log, services } = logging();
      if (failure instanceof Error) failure.diagnostic = { phase: "render", code: "invalid-scene" };
      const controller = createPresentationController({ state, elements: { gateSymbolModeSelect: {}, mount: {}, leftMount: {}, rightMount: {} }, services: {
        ...services, persistSession() {}, compareViewSessions: { dispatch() {} },
        renderGraphMount: async () => { throw failure; }
      } });
      controller.commitGateSymbolMode("conventional");
      await new Promise((resolve) => setImmediate(resolve));
      const [entry] = log.entries({ phase: "render", level: "error" });
      assert.ok(entry, "a rejected render must enter Process Log");
      assert.equal(entry.details.view, compare ? "compare" : "single");
      if (failure instanceof Error) {
        assert.equal(entry.details.error.stack, failure.stack);
        assert.equal(entry.details.error.diagnostic.code, "invalid-scene");
      } else {
        assert.equal(entry.details.error, failure);
        assert.ok(entry.message.endsWith(String(failure)));
      }
    });
  }

  test(`cancelled or superseded presentation failures do not enter logs; compare=${compare}`, async () => {
    for (const superseded of [false, true]) {
      const state = createAppState(DEFAULT_LAYOUT_POLICY);
      const graph = { nodes: [], edges: [] };
      state.graph = graph;
      state.compare.active = compare;
      state.compare.graphs = { left: graph, right: graph };
      const { log, services } = logging();
      const rejectors = [];
      const controller = createPresentationController({ state, elements: { gateSymbolModeSelect: {}, mount: {}, leftMount: {}, rightMount: {} }, services: {
        ...services, persistSession() {}, compareViewSessions: { dispatch() {} },
        renderGraphMount: () => new Promise((_, reject) => rejectors.push(reject))
      } });
      controller.commitGateSymbolMode("conventional");
      if (superseded) {
        state.scene = {};
        state.compare.scenes = { left: {}, right: {} };
      }
      const error = Object.assign(new Error("old render"), { name: superseded ? "Error" : "AbortError" });
      rejectors.forEach((reject) => reject(error));
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(log.size, 0);
    }
  });

  for (const failure of [new Error("history mount failed"), null, "plain rejection"]) {
    test(`cached history failures release restore state; compare=${compare}; reason=${String(failure)}`, async () => {
      const state = createAppState(DEFAULT_LAYOUT_POLICY);
      state.currentModule = { name: "top", displayName: "top" };
      state.currentSource = "module top; endmodule";
      state.graph = { nodes: [], edges: [] };
      state.compare.active = compare;
      state.compare.leftModuleName = "top";
      state.compare.rightModuleName = "peer";
      state.compare.graphs = { left: state.graph, right: state.graph };
      state.singleWorkspaceIdentity = createSingleWorkspaceIdentity(state);
      state.compare.workspaceIdentity = createCompareWorkspaceIdentity(state);
      const entry = createViewHistoryEntry(state);
      entry.presentationPolicy = { gateSymbolMode: "conventional" };
      const { log, services } = logging();
      const noOp = () => {};
      const controller = createHistoryController({ state,
        elements: new Proxy({}, { get: (target, key) => target[key] ||= {} }),
        services: new Proxy({ ...services, readCellLibrary: () => null,
          renderGraphMount: async () => { throw failure; },
          renderCurrentModuleGraph: () => assert.fail("must reuse Single workspace"),
          renderCompareGraphs: () => assert.fail("must reuse Compare workspace")
        }, { get: (target, key) => key in target ? target[key] : noOp }) });
      controller.restoreViewHistoryEntry(entry);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(state.restoringViewHistory, false);
      const [saved] = log.entries({ phase: "navigation", level: "error" });
      if (failure instanceof Error) assert.equal(saved.details.error.stack, failure.stack);
      else {
        assert.equal(saved.details.error, failure);
        assert.ok(saved.message.endsWith(String(failure)));
      }
      assert.equal(saved.details.view, compare ? "compare" : "single");
    });
  }
}

test("Cell Config file read errors retain the filename and stack", async () => {
  const { log, services } = logging();
  const failure = new Error("file unavailable");
  const controller = createCellConfigController({ state: createAppState(DEFAULT_LAYOUT_POLICY), elements: {}, services: {
    ...services, cellConfigUseCases: { prepareImport() { assert.fail("read failed first"); } }
  } });
  const target = { value: "selected", files: [{ name: "cells.json", text: async () => { throw failure; } }] };
  await controller.handleCellConfigImport({ target });
  assert.equal(target.value, "");
  const [entry] = log.entries({ phase: "import", level: "error" });
  assert.equal(entry.details.fileName, "cells.json");
  assert.equal(entry.details.error.stack, failure.stack);
});

test("timing and design import failures preserve diagnostics, and post-parse setup failures are logged", () => {
  const { log, services } = logging();
  const controller = createInputController({ state: createAppState(DEFAULT_LAYOUT_POLICY), elements: {}, services });
  assert.throws(() => controller.loadTimingText("not timing", "bad.txt"));
  assert.ok(log.entries({ phase: "timing", level: "error" })[0].details.error.stack);
  assert.throws(() => controller.loadDesign("not verilog", "bad.v"));
  assert.ok(log.entries({ phase: "parse", level: "error" })[0].details.error.stack);
  assert.throws(() => controller.loadDesign("module top; endmodule", "top.v", { moduleName: "missing" }));
  const [entry] = log.entries({ phase: "import", level: "error" });
  assert.equal(entry.details.label, "top.v");
  assert.match(entry.details.error.message, /Startup module not found/);
});
