import assert from "node:assert/strict";
import test from "node:test";
import { createCellConfigController } from "../../src/app/cell_config_controller.js";
import { createGoldenController } from "../../src/app/golden_controller.js";
import { createCellConfigUseCases } from "../../src/domains/netlist/cell_config_use_cases.js";
import { createAppState } from "../../src/app/appState.js";
import { DEFAULT_LAYOUT_POLICY } from "../../src/layout/layoutPolicy.js";
import { createProcessLog } from "../../src/app/processLog.js";
import { createEmptyCellConfig, setCellConfigDefinition, serializeCellConfig } from "../../src/infer/cellConfig.js";

function logging() {
  const log = createProcessLog(), statuses = [];
  return { log, statuses, services: {
    logProcess: (level, phase, message, details) => log.append({ level, phase, message, details }),
    setStatus: (message) => statuses.push(message)
  } };
}

function configHarness(t, { save = (bundle) => bundle, refresh = () => {}, confirm = true } = {}) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { confirm: () => confirm } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else delete globalThis.window;
  });
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  state.cellConfig = setCellConfigDefinition(createEmptyCellConfig(), "X", { gateKind: "BUF", pins: {} });
  state.fullGraph = { nodes: [{ id: "cell:u1", kind: "cell", ref: { type: "X" } }], edges: [] };
  state.selectedNodeId = "cell:u1";
  state.compare.active = true;
  const elements = {
    cellDefinitionBody: {}, deleteCellDefinitionButton: {}, editCellDefinitionButton: {},
    exportCellConfigButton: {}, resetCellConfigButton: {},
    cellDefinitionDialog: { open: false, showModal() { this.open = true; }, close() { this.open = false; } },
    cellDefinitionForm: { querySelectorAll: () => [], querySelector: () => ({ value: "INV" }) }
  };
  const logged = logging();
  const controller = createCellConfigController({ state, elements, services: {
    ...logged.services, cellConfigUseCases: createCellConfigUseCases({ save }), renderCompareGraphs: refresh
  } });
  controller.openSelectedCellDefinition();
  return { ...logged, controller, state, elements };
}

async function runConfigAction(controller, action, config) {
  if (action === "save") return controller.saveActiveCellDefinition({ preventDefault() {} });
  if (action === "delete") return controller.deleteActiveCellDefinition();
  if (action === "reset") return controller.resetAllCellConfig();
  const target = { value: "cells.json", files: [{ name: "cells.json", text: async () => serializeCellConfig(config) }] };
  await controller.handleCellConfigImport({ target });
  assert.equal(target.value, "");
}

for (const action of ["save", "delete", "reset", "import"]) {
  test(`Cell Config ${action} storage failure keeps prior state and logs the actual cause`, async (t) => {
    const failure = new Error("write denied", { cause: new Error("storage full") });
    failure.code = "QUOTA";
    const { controller, state, elements, log, statuses } = configHarness(t, {
      save() { throw failure; }, refresh() { assert.fail("must not refresh after failed persistence"); }
    });
    const previous = state.cellConfig;
    await runConfigAction(controller, action, previous);
    assert.strictEqual(state.cellConfig, previous);
    assert.equal(elements.cellDefinitionDialog.open, true);
    assert.equal(log.size, 1);
    const [entry] = log.entries({ phase: "persistence", level: "error" });
    assert.equal(entry.details.operation, `${action}-cell-config`);
    assert.equal(entry.details.error.stack, failure.stack);
    assert.equal(entry.details.error.cause.message, "storage full");
    assert.equal(entry.details.error.code, "QUOTA");
    if (action === "import") assert.equal(entry.details.fileName, "cells.json");
    assert.match(statuses.at(-1), /could not be saved/);
  });

  test(`Cell Config ${action} refresh failure is distinct from a successful save`, async (t) => {
    const { controller, state, log, statuses } = configHarness(t, { refresh() { throw new Error("refresh unavailable"); } });
    const previous = state.cellConfig;
    await runConfigAction(controller, action, previous);
    assert.notStrictEqual(state.cellConfig, previous);
    assert.equal(log.entries({ phase: "persistence", level: "info" }).length, 1);
    assert.equal(log.entries({ phase: "persistence", level: "error" }).length, 0);
    const [entry] = log.entries({ phase: "render", level: "error" });
    assert.equal(entry.details.operation, `${action}-cell-config`);
    assert.match(entry.details.error.stack, /refresh unavailable/);
    assert.match(statuses.at(-1), /saved, but workspace refresh failed/);
  });
}

test("cancelled Cell Config reset and conflicting import do not write or log errors", async (t) => {
  const { controller, state, log } = configHarness(t, { confirm: false, save() { assert.fail("cancelled"); } });
  const previous = state.cellConfig;
  await runConfigAction(controller, "reset", previous);
  await runConfigAction(controller, "import", previous);
  assert.strictEqual(state.cellConfig, previous);
  assert.equal(log.size, 0);
});

for (const operation of ["export-svg", "export-golden", "export-cell-config"]) {
  for (const stage of ["download", "serialize"]) {
    test(`${operation} ${stage} failure has export context and never claims success`, () => {
      const state = createAppState(DEFAULT_LAYOUT_POLICY);
      state.currentModule = { name: "top", displayName: "top" };
      state.singleWorkspaceIdentity = {};
      state.graph = { nodes: [], edges: [], moduleName: "top", width: 0, height: 0 };
      state.autoGraph = state.graph;
      state.scene = { kind: "svg-scene.v1", bounds: { width: 0, height: 0 }, edgeCount: 0, nodeCount: 0,
        readEdges: () => [], readNodes: () => [] };
      const failure = new Error("download refused");
      let downloads = 0;
      if (stage === "serialize") {
        state.scene = null;
        state.cellConfig = { kind: "invalid" };
      }
      const { log, statuses, services } = logging();
      const download = () => { downloads++; throw failure; };
      services.browserDownload = { text: download, json: download };
      if (operation === "export-cell-config") createCellConfigController({ state, elements: {}, services }).exportCellConfig();
      else {
        const controller = createGoldenController({ state, elements: {}, services });
        if (operation === "export-svg") controller.exportCurrentSvg();
        else controller.saveLayoutGolden();
      }
      assert.equal(downloads, stage === "download" ? 1 : 0);
      assert.equal(log.size, 1);
      const [entry] = log.entries({ phase: "export", level: "error" });
      assert.equal(entry.details.operation, operation);
      assert.ok(entry.details.fileName);
      assert.ok(entry.details.error.stack);
      if (stage === "download") assert.equal(entry.details.error.stack, failure.stack);
      assert.equal(statuses.length, 1);
      assert.match(statuses[0], /export failed/);
    });
  }
}
