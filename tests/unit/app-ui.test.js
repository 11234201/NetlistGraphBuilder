import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createAppState,
  restoreCompareWorkspace,
  restoreModuleWorkspace,
  resetDesignWorkspace,
  resetModuleWorkspace,
  resetTimingPresentation,
  saveCompareWorkspace,
  saveModuleWorkspace
} from "../../src/app/appState.js";
import { parseDesignSource } from "../../src/app/designInput.js";
import { DEFAULT_LAYOUT_POLICY } from "../../src/layout/layoutPolicy.js";
import { renderAdjustPanel } from "../../src/ui/adjustPanel.js";
import {
  getTimingBadgeChoices,
  renderTimingPanel,
  updateTimingBadgeChoices
} from "../../src/ui/timingPanel.js";

test("app state reset helpers keep lifecycle boundaries explicit", () => {
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  assert.equal(state.showAliases, false);
  assert.equal(state.compare.active, false);
  assert.equal(state.compare.synchronized, true);
  assert.equal(state.compare.layout, "vertical");
  assert.equal(state.layoutProviderId, "simple-layered");
  state.design = { modules: [] };
  state.timing = { instanceCount: 1 };
  state.selectedNodeId = "cell:u0";
  state.viewMode = "fanin";
  state.coneRootNodeId = "cell:u0";
  state.nodePositions.set("cell:u0", { x: 10, y: 20 });
  state.timingBadgeChoices.u0 = [{ pin: "Z", metric: "at" }];
  state.timingBadgePositions.u0 = "top-left";

  resetTimingPresentation(state);
  assert.deepEqual(state.timingBadgeChoices, {});
  assert.deepEqual(state.timingBadgePositions, {});
  assert.equal(state.nodePositions.size, 1);
  assert.equal(state.timing.instanceCount, 1);

  resetModuleWorkspace(state);
  assert.equal(state.nodePositions.size, 0);
  assert.deepEqual(state.graphOverrides, { nodeProperties: {}, cellPinDirections: {} });
  assert.equal(state.viewMode, "whole");
  assert.equal(state.coneRootNodeId, null);
  assert.equal(state.timing.instanceCount, 1);

  resetDesignWorkspace(state);
  assert.equal(state.timing, null);
  assert.equal(state.selectedNodeId, null);
  assert.deepEqual(state.design, { modules: [] });
});

test("module and compare workspace adjustments survive switching", () => {
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  state.nodePositions.set("cell:u0", { x: 120, y: 80 });
  state.nodeSizes.set("cell:u0", { width: 180, height: 90 });
  state.graphOverrides.nodeProperties["cell:u0"] = { label: "adjusted" };
  saveModuleWorkspace(state, "left");

  state.nodePositions = new Map();
  state.nodeSizes = new Map();
  state.graphOverrides = { nodeProperties: {}, cellPinDirections: {} };
  assert.equal(restoreModuleWorkspace(state, "left"), true);
  assert.deepEqual(state.nodePositions.get("cell:u0"), { x: 120, y: 80 });
  assert.equal(state.nodeSizes.get("cell:u0").width, 180);
  assert.equal(state.graphOverrides.nodeProperties["cell:u0"].label, "adjusted");

  state.compare.leftModuleName = "left";
  state.compare.rightModuleName = "right";
  state.compare.nodePositions.right.set("cell:u1", { x: 240, y: 160 });
  state.compare.timingBadgePositions.right.u1 = "top-left";
  saveCompareWorkspace(state);
  state.compare.nodePositions.right.clear();
  state.compare.timingBadgePositions.right = {};
  assert.equal(restoreCompareWorkspace(state, "left", "right"), true);
  assert.deepEqual(state.compare.nodePositions.right.get("cell:u1"), { x: 240, y: 160 });
  assert.equal(state.compare.timingBadgePositions.right.u1, "top-left");
});

test("timing panel helpers render and update badge choices without app state", () => {
  const node = {
    timing: {
      worstPin: "A1",
      worstSlack: -0.35,
      badgePosition: "bottom-right",
      badges: [
        { pin: "Z", metric: "at", label: "Z at 0.424" },
        { pin: "Z", metric: "slack", label: "Z slack -0.334" }
      ],
      pins: {
        A1: { pin: "A1", at: 0.45, rt: 0.1, slack: -0.35 },
        Z: { pin: "Z", at: 0.424, rt: 0.09, slack: -0.334 }
      }
    }
  };
  const defaults = getTimingBadgeChoices(node, {}, "u0");
  const selected = updateTimingBadgeChoices(defaults, "A1", "rt", true);
  const html = renderTimingPanel(node, selected);

  assert.deepEqual(selected.at(-1), { pin: "A1", metric: "rt" });
  assert.match(html, /Badge position/);
  assert.match(html, /value="bottom-right" selected/);
  assert.match(html, /data-timing-pin="A1" data-timing-metric="rt" checked/);
});

test("adjust panel escapes editable property values", () => {
  const html = renderAdjustPanel({
    id: "cell:u0",
    kind: "cell",
    label: "<u0>",
    title: "BUF",
    subtitle: "BUF&X",
    width: 120,
    height: 72,
    ref: { pins: [] }
  }, true);

  assert.match(html, /value="&lt;u0&gt;"/);
  assert.match(html, /value="BUF&amp;X"/);
});

test("lightweight inputs expose paste and Golden load controls", async () => {
  const html = await readFile(new URL("../../index.html", import.meta.url), "utf8");

  assert.match(html, /id="pasteNetlistButton"/);
  assert.match(html, /id="netlistTextDialog"/);
  assert.match(html, /id="netlistTextInput"/);
  assert.match(html, /id="goldenInput"[^>]+accept="\.json,application\/json"/);
  assert.match(html, /id="dropOverlay"/);
});

test("pasted design input rejects text without a module", () => {
  assert.equal(parseDesignSource("module m(input a, output y); assign y = a; endmodule").modules[0].name, "m");
  assert.throws(() => parseDesignSource("this is not a netlist"), /No module declarations found/);
});
