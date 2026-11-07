import assert from "node:assert/strict";
import test from "node:test";
import { createLegacyPort } from "../../src/app/legacy_port.js";
import { createStateCommandsController } from "../../src/app/state_commands_controller.js";
import { createSingleViewSessionBridge } from "../../src/app/single_view_session_bridge.js";
import { createAppState } from "../../src/app/appState.js";
import { validateWorkbenchServiceDependency } from "../../src/app/workbench_controllers.js";
import { DEFAULT_LAYOUT_POLICY } from "../../src/layout/layoutPolicy.js";

test("legacy ports expose explicit live fields without allowing additional state", () => {
  let target = { value: 1, privateField: 2 };
  const port = createLegacyPort(() => target, ["value"], { writable: true });
  assert.deepEqual(Object.keys(port), ["value"]);
  assert.equal(port.privateField, undefined);
  port.value = 3;
  assert.equal(target.value, 3);
  target = { value: 4 };
  assert.equal(port.value, 4);
  assert.throws(() => { port.extra = 1; }, TypeError);
});

test("dependency ports are read-only and Compare state rejects undeclared fields", () => {
  const target = { value: 1 };
  const port = createLegacyPort(() => target, ["value"]);
  assert.throws(() => { port.value = 2; }, TypeError);
  assert.equal(target.value, 1);
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  assert.throws(() => { state.compare.unownedField = true; }, TypeError);
});

test("nested state ports expose only explicitly declared aggregate capabilities", () => {
  const target = { compare: { active: false, graphs: { left: null } } };
  const port = createLegacyPort(() => target, ["compare"], {
    writable: true, nestedFields: { compare: ["active"] }
  });
  port.compare.active = true;
  assert.equal(target.compare.active, true);
  assert.throws(() => port.compare.graphs, /Undeclared nested state dependency/);
  assert.throws(() => { port.compare.graphs = {}; }, /Undeclared nested state mutation/);
});

test("workbench dependency validation rejects present-but-invalid services", () => {
  assert.throws(() => validateWorkbenchServiceDependency({ action: undefined }, "action", "probe"), /expected function/);
  assert.throws(() => validateWorkbenchServiceDependency({ workspaceJobs: () => {} }, "workspaceJobs", "probe"), /expected object/);
  assert.doesNotThrow(() => validateWorkbenchServiceDependency({ action() {} }, "action", "probe"));
});

test("state command adapter commits through ViewSession and projects detached legacy mirrors", () => {
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  state.document = { documentId: "d" };
  state.currentModule = { name: "top" };
  const bridge = createSingleViewSessionBridge({ state, getDocumentId: () => "d" });
  let recorded = 0;
  const controller = createStateCommandsController({ state, elements: {}, services: {
    singleViewSession: bridge, recordViewHistory: () => recorded++
  } });
  controller.setSingleTransform({ x: 2, y: 3, scale: 1 });
  const initial = bridge.sessions.require("single:primary");
  controller.setSingleFocusedDepths(2, 4);
  const changed = bridge.sessions.require("single:primary");
  assert.equal(changed.computationRevision, initial.computationRevision + 1);
  assert.equal(state.faninDepth, 2);
  assert.equal(state.fanoutDepth, 4);
  const position = { x: 50, y: 60 };
  controller.setSingleOverrides({ nodePositions: new Map([["cell:u", position]]) });
  position.x = 999;
  assert.equal(bridge.sessions.require("single:primary").overrides.nodePositions.get("cell:u").x, 50);
  assert.equal(state.nodePositions.get("cell:u").x, 50);
  assert.equal(recorded, 2);
});
