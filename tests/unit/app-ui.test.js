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
  collectCellTypeSummary,
  createInferredCellDefinition,
  renderCellDefinitionEditor
} from "../../src/ui/cellDefinitionPanel.js";
import { renderProcessLogEntries } from "../../src/ui/processLogPanel.js";
import {
  getTimingBadgeChoices,
  renderTimingPanel,
  updateTimingBadgeChoices
} from "../../src/ui/timingPanel.js";

test("app state reset helpers keep lifecycle boundaries explicit", () => {
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  assert.equal(state.showAliases, false);
  assert.equal(state.collapseLargeGroups, false);
  assert.equal(state.compare.active, false);
  assert.equal(state.compare.synchronized, true);
  assert.equal(state.compare.focusedRootsSynchronized, true);
  assert.equal(state.compare.layout, "vertical");
  assert.equal(state.scene, null);
  assert.deepEqual(state.compare.scenes, { left: null, right: null });
  assert.equal(state.layoutProviderId, "simple-layered");
  state.design = { modules: [] };
  state.timing = { instanceCount: 1 };
  state.selectedNodeId = "cell:u0";
  state.viewMode = "focused";
  state.coneRootNodeId = "cell:u0";
  state.nodePositions.set("cell:u0", { x: 10, y: 20 });
  state.timingBadgeChoices.u0 = [{ pin: "Z", metric: "at" }];
  state.timingBadgePositions.u0 = "top-left";
  state.scene = { kind: "svg-scene.v1" };

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
  assert.equal(state.scene, null);
  assert.deepEqual(state.design, { modules: [] });
});

test("module and compare workspace adjustments survive switching", () => {
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  state.nodePositions.set("cell:u0", { x: 120, y: 80 });
  state.nodeSizes.set("cell:u0", { width: 180, height: 90 });
  state.graphOverrides.nodeProperties["cell:u0"] = { label: "adjusted" };
  state.viewMode = "focused";
  state.coneRootNodeId = "cell:u0";
  state.faninDepth = 1;
  state.fanoutDepth = 4;
  saveModuleWorkspace(state, "left");

  state.nodePositions = new Map();
  state.nodeSizes = new Map();
  state.graphOverrides = { nodeProperties: {}, cellPinDirections: {} };
  assert.equal(restoreModuleWorkspace(state, "left"), true);
  assert.deepEqual(state.nodePositions.get("cell:u0"), { x: 120, y: 80 });
  assert.equal(state.nodeSizes.get("cell:u0").width, 180);
  assert.equal(state.graphOverrides.nodeProperties["cell:u0"].label, "adjusted");
  assert.equal(state.viewMode, "focused");
  assert.equal(state.coneRootNodeId, "cell:u0");
  assert.equal(state.faninDepth, 1);
  assert.equal(state.fanoutDepth, 4);

  state.compare.leftModuleName = "left";
  state.compare.rightModuleName = "right";
  state.compare.nodePositions.right.set("cell:u1", { x: 240, y: 160 });
  state.compare.timingBadgePositions.right.u1 = "top-left";
  state.compare.focusedRootNodeIds.left = ["cell:u0"];
  state.compare.focusedRootsSynchronized = false;
  saveCompareWorkspace(state);
  state.compare.nodePositions.right.clear();
  state.compare.timingBadgePositions.right = {};
  assert.equal(restoreCompareWorkspace(state, "left", "right"), true);
  assert.deepEqual(state.compare.nodePositions.right.get("cell:u1"), { x: 240, y: 160 });
  assert.equal(state.compare.timingBadgePositions.right.u1, "top-left");
  assert.deepEqual(state.compare.focusedRootNodeIds.left, ["cell:u0"]);
  assert.equal(state.compare.focusedRootsSynchronized, false);
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
  const topbar = html.match(/<header class="topbar">([\s\S]*?)<\/header>/)?.[1] || "";

  assert.match(html, /id="pasteNetlistButton"/);
  assert.match(html, /id="netlistTextDialog"/);
  assert.match(html, /id="netlistTextInput"/);
  assert.match(html, /id="goldenInput"[^>]+accept="\.json,application\/json"/);
  assert.match(html, /id="dropOverlay"/);
  assert.match(html, /id="editCellDefinitionButton"/);
  assert.match(html, /id="cellConfigInput"/);
  assert.match(html, /id="cellDefinitionDialog"/);
  assert.match(html, /id="focusedViewButton"/);
  assert.doesNotMatch(html, /id="faninViewButton"|id="fanoutViewButton"/);
  assert.match(html, /id="faninDepthInput"[^>]+min="0"/);
  assert.match(html, /id="fanoutDepthInput"[^>]+min="0"/);
  assert.match(html, /id="moduleBackButton"[^>]+disabled/);
  assert.match(html, /id="moduleForwardButton"[^>]+disabled/);
  assert.match(topbar, /id="moduleHierarchyMenu"[\s\S]*id="moduleHierarchyFilter"[\s\S]*id="moduleHierarchyTree"/);
  assert.doesNotMatch(html, /id="moduleSelect"|id="moduleHierarchyPanel"/);
  assert.match(html, /id="focusSelectedButton"[^>]+disabled/);
  assert.match(html, /id="syncCompareFocusInput" type="checkbox" checked/);
  assert.match(html, /id="setFocusedRootButton"[^>]+disabled/);
  assert.match(html, /id="wireSpacingInput"[^>]+min="4"[^>]+max="96"[^>]+step="4"[^>]+value="24"/);
  assert.match(html, /id="wireSpacingNumberInput"[^>]+type="number"[^>]+min="4"[^>]+max="96"[^>]+step="4"[^>]+value="24"/);
  assert.match(html, /id="wireSpacingValue">24<\/output>/);
  assert.match(html, /id="cellSpacingInput"[^>]+min="4"[^>]+max="320"[^>]+step="4"/);
  assert.match(html, /id="cellSpacingNumberInput"[^>]+type="number"[^>]+min="4"[^>]+max="320"[^>]+step="4"[^>]+value="8"/);
  assert.match(html, /id="processLogDrawer"/);
  assert.doesNotMatch(html, /collapseGroupsInput|collapseAllButton/);
  assert.match(html, /id="processLogLevelFilter"/);
  assert.match(html, /id="processLogPhaseFilter"/);
  assert.match(html, /id="exportProcessLogButton"/);
  assert.match(topbar, /<summary[^>]*>Import<\/summary>/);
  assert.match(topbar, /<summary[^>]*>More<\/summary>/);
  assert.match(topbar, /class="topbar-search"[\s\S]*id="searchInput"/);
  assert.doesNotMatch(html, /class="panel-section search-panel"/);
  assert.doesNotMatch(topbar, /id="layoutProviderSelect"|id="timingSnapshotSelect"|id="wireSpacingInput"/);
  assert.match(html, /<details class="panel-section collapsible-panel layout-settings-panel" open>/);
  assert.match(html, /<details class="panel-section collapsible-panel timing-policy-panel" open>/);
});

test("app forwards both Focused depths into the module workspace", async () => {
  const source = await readFile(new URL("../../src/app/main.js", import.meta.url), "utf8");
  const workspaceCall = source.match(/buildModuleWorkspace\(\{([\s\S]*?)\n  \}\);/)?.[1] || "";

  assert.match(workspaceCall, /faninDepth: state\.faninDepth/);
  assert.match(workspaceCall, /fanoutDepth: state\.fanoutDepth/);
  assert.match(source, /faninDepthInput\.addEventListener\("input", scheduleFocusedDepthChange\)/);
  assert.match(source, /fanoutDepthInput\.addEventListener\("input", scheduleFocusedDepthChange\)/);
});

test("connection navigation reveals hidden cells inside Focused instead of opening Whole", async () => {
  const source = await readFile(new URL("../../src/app/main.js", import.meta.url), "utf8");
  const handler = source.match(/function navigateSingleSelectionTarget\(target\) \{([\s\S]*?)\n\}\n\nfunction focusSingleSelectionTarget/)?.[1] || "";

  assert.match(handler, /type: "selection\.reveal"/);
  assert.match(handler, /replaceActiveWhenFull: true/);
  assert.doesNotMatch(handler, /setSingleViewMode\("whole"\)/);
});

test("search reveals a target outside the current canvas through Focused instead of Whole", async () => {
  const source = await readFile(new URL("../../src/app/main.js", import.meta.url), "utf8");
  const handler = source.match(/function activateSearchResult\(result\) \{([\s\S]*?)\n\}\n\nfunction revealSearchTarget/)?.[1] || "";

  assert.match(handler, /revealSearchTarget\(/);
  assert.match(source, /function revealSearchTarget\([\s\S]*?visibleObjectKeys: singleViewSession\.visibleObjectKeys\(\)/);
  assert.doesNotMatch(handler, /setSingleViewMode\("whole"\)/);
});

test("hidden net search hits never become dangling selections", async () => {
  const source = await readFile(new URL("../../src/app/main.js", import.meta.url), "utf8");
  const activate = source.match(/function activateSearchResult\(result\) \{([\s\S]*?)\n\}\n\nfunction revealSearchTarget/)?.[1] || "";
  const handler = activate.match(/if \(target\.kind === "net"\) \{([\s\S]*?)\n  \}\n\n  const fullNode/)?.[1] || "";

  assert.match(handler, /resolveSearchTargetAction\(target, state\.graph, state\.fullGraph\)/);
  assert.match(handler, /could not be focused/);
  assert.doesNotMatch(handler, /setSelectedNet\(target\.name\);/);
});

test("search history captures the final selection and viewport together", async () => {
  const source = await readFile(new URL("../../src/app/main.js", import.meta.url), "utf8");
  const handler = source.match(/function activateSearchResult\(result\) \{([\s\S]*?)\n\}\n\nfunction revealSearchTarget/)?.[1] || "";

  assert.match(handler, /setSelectedNode\(positioned\.id, false\)[\s\S]*centerGraphPoint\([\s\S]*recordViewHistory\(\)/);
  assert.match(handler, /setSelectedNet\(target\.name, false\)[\s\S]*centerGraphPoint\([\s\S]*recordViewHistory\(\)/);
});

test("fit-to-view is one explicit view-history operation", async () => {
  const source = await readFile(new URL("../../src/app/main.js", import.meta.url), "utf8");
  const handler = source.match(/function fitToView\(\) \{([\s\S]*?)\n\}\n\nfunction exportCurrentSvg/)?.[1] || "";

  assert.equal((handler.match(/recordViewHistory\(\)/g) || []).length, 2);
});

test("view-history restore reuses the workspace for selection-only changes", async () => {
  const source = await readFile(new URL("../../src/app/main.js", import.meta.url), "utf8");
  const handler = source.match(/function restoreViewHistoryEntry\(entry\) \{([\s\S]*?)\n\}\n\nfunction createSingleWorkspaceHistoryIdentity/)?.[1] || "";

  assert.match(handler, /createSingleWorkspaceHistoryIdentity\(\)/);
  assert.match(handler, /canReuseWorkspace/);
  assert.match(handler, /createNetlistScene\(state\.graph/);
  assert.match(handler, /renderCurrentModuleGraph\(/);
});

test("viewport gesture history metadata is only written after a completed pan", async () => {
  const source = await readFile(new URL("../../src/app/main.js", import.meta.url), "utf8");
  const panHandlers = source.match(/onEnd\(\{ didPan, cancelled \}\) \{([\s\S]*?)\n    \}/g) || [];

  assert.equal(panHandlers.length, 2);
  panHandlers.forEach((handler) => {
    assert.match(handler, /didPan && !cancelled\) persistSession\(\{[\s\S]*label: "Viewport gesture"/);
    assert.doesNotMatch(handler, /!didPan && !cancelled\).*Viewport gesture/);
  });
  assert.match(source, /function persistSession\(metadata = \{\}\)/);
  assert.match(source, /recordViewHistory\(metadata\)/);
});

test("compare history metadata identifies the side that owns an override or pan", async () => {
  const source = await readFile(new URL("../../src/app/main.js", import.meta.url), "utf8");
  const override = source.match(/function setCompareOverrides\(side, overrides\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(override, /affectedSessionIds: \[`compare:\$\{side\}`\]/);
  const comparePan = source.match(/function bindCompareCanvas\(side\) \{([\s\S]*?)\n\}/)?.[1] || source;
  assert.match(comparePan, /affectedSessionIds: \[`compare:\$\{side\}`\]/);
});

test("ambiguous module occurrences expose an explicit chooser wired to selectModule", async () => {
  const source = await readFile(new URL("../../src/app/main.js", import.meta.url), "utf8");
  const handler = source.match(/function handleOccurrenceChoiceClick\(event\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(source, /moduleOccurrenceChoices/);
  assert.match(source, /renderOccurrenceChoices\(occurrences, moduleName\)/);
  assert.match(handler, /selectModule\(button\.dataset\.occurrenceModule/);
  assert.match(handler, /occurrencePath/);
});

test("focused net chips retain the active occurrence path", async () => {
  const source = await readFile(new URL("../../src/app/main.js", import.meta.url), "utf8");
  const handler = source.match(/function renderFocusedRootList\(\) \{([\s\S]*?)\n\}\n\nfunction updateFocusSelectedControl/)?.[1] || "";
  assert.match(handler, /netName && !context\.compare/);
  assert.match(handler, /state\.occurrenceContext\?\.occurrencePath/);
});

test("compare layout dispatches independent side jobs", async () => {
  const source = await readFile(new URL("../../src/app/main.js", import.meta.url), "utf8");
  assert.match(source, /kind: `compare-\$\{side\}-workspace`/);
  assert.match(source, /Promise\.all\(jobs\.map\(\(job\) => job\.promise\)\)/);
  assert.match(source, /buildCompareSideWorkspace\(/);
});

test("compound view actions commit one history transaction", async () => {
  const source = await readFile(new URL("../../src/app/main.js", import.meta.url), "utf8");
  assert.match(source, /createViewHistoryTransaction\(\{[\s\S]*commit: \(metadata\) => recordViewHistory\(metadata\)/);
  assert.match(source, /function applyCompareSelection\(\) \{[\s\S]*runViewHistoryTransaction\(\{ label: "Compare selection" \}/);
  assert.match(source, /function setViewMode\(mode\) \{[\s\S]*runViewHistoryTransaction\(\{ label: `View mode: \$\{mode\}` \}/);
  assert.match(source, /function setCompareViewMode\(mode\) \{[\s\S]*runViewHistoryTransaction\(\{ label: `Compare view mode: \$\{mode\}` \}/);
  assert.match(source, /function resetLayoutOverrides\(\) \{[\s\S]*runViewHistoryTransaction\(\{ label: "Reset layout overrides" \}/);
  assert.match(source, /function loadLayoutGolden\(imported, label\) \{[\s\S]*runViewHistoryTransaction\(\{ label: `Load Golden: \$\{label\}` \}/);
});

test("view bridges forward committed commands to the history boundary", async () => {
  const main = await readFile(new URL("../../src/app/main.js", import.meta.url), "utf8");
  const bus = await readFile(new URL("../../src/application/command_bus.js", import.meta.url), "utf8");
  assert.match(main, /onDispatch: noteViewCommandDispatch/);
  assert.match(main, /function noteViewCommandDispatch\(command, result\)/);
  assert.match(main, /pendingViewCommandMetadata/);
  assert.match(bus, /onDispatch\?\.\(command, result\)/);
});

test("toolbar and Alt+Arrow use only the unified view timeline", async () => {
  const source = await readFile(new URL("../../src/app/main.js", import.meta.url), "utf8");
  const navigate = source.match(/function navigateViewHistory\(delta\) \{([\s\S]*?)\n\}\n\nfunction restoreViewHistoryEntry/)?.[1] || "";
  assert.doesNotMatch(navigate, /ModuleHistory|navigateModuleHistory/);
  const shortcut = source.match(/function handleModuleHistoryShortcut\(event\) \{([\s\S]*?)\n\}\n\nfunction handleViewHistoryShortcut/)?.[1] || "";
  assert.match(shortcut, /navigateViewHistory\(event\.key === "ArrowLeft" \? -1 : 1\)/);
  assert.doesNotMatch(shortcut, /navigateModuleHistory\(event\.key/);
});

test("compare view-history restore keeps side graphs when computation identity is unchanged", async () => {
  const source = await readFile(new URL("../../src/app/main.js", import.meta.url), "utf8");
  const handler = source.match(/function restoreCompareViewHistoryEntry\(entry\) \{([\s\S]*?)\n\}\n\nfunction createCompareWorkspaceHistoryIdentity/)?.[1] || "";

  assert.match(handler, /createCompareWorkspaceHistoryIdentity\(\)/);
  assert.match(handler, /canReuseWorkspace/);
  assert.match(handler, /renderGraphMount\(elements\.leftMount/);
  assert.match(handler, /renderCompareGraphs\(/);
});

test("screen rendering and exports consume prepared scenes", async () => {
  const source = await readFile(new URL("../../src/app/main.js", import.meta.url), "utf8");

  assert.match(source, /renderSvgSceneIntoMount\(mount, renderOptions\.scene/);
  assert.match(source, /svgSnapshot: renderSvgScene\(state\.scene\)/);
  assert.doesNotMatch(source, /renderSchematicSvg/);
});

test("process log renderer escapes messages and detail values", () => {
  const html = renderProcessLogEntries([{
    timestamp: "2026-08-07T00:00:00.000Z",
    level: "error",
    phase: "parse",
    message: "<script>alert(1)</script>",
    details: { fileName: "bad<&>.v" }
  }]);

  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /bad&lt;&amp;&gt;\.v/);
});

test("Cell Definition editor summarizes a type and escapes names", () => {
  const summary = collectCellTypeSummary({ modules: [{ cells: [
    { type: "X&1", pins: [{ pin: "A", pinDisplayName: "A<0>" }, { pin: "Z" }] },
    { type: "X&1", pins: [{ pin: "A", pinDisplayName: "A<0>" }] }
  ] }] }, "X&1");
  const html = renderCellDefinitionEditor(summary, {
    gateKind: "BUF",
    pins: { A: "input", Z: "output" }
  });
  assert.equal(summary.instanceCount, 2);
  assert.equal(summary.pins.find((pin) => pin.canonicalName === "A").count, 2);
  assert.match(html, /X&amp;1/);
  assert.match(html, /A&lt;0&gt;/);
  assert.match(html, /value="BUF" selected/);
});

test("Cell Definition editor can start from built-in inference rules", () => {
  const summary = collectCellTypeSummary({ modules: [{ cells: [{
    type: "ND2D1",
    pins: [{ pin: "A1" }, { pin: "A2" }, { pin: "ZN" }]
  }] }] }, "ND2D1");
  const definition = createInferredCellDefinition(summary);
  const html = renderCellDefinitionEditor(summary, definition);

  assert.equal(definition.gateKind, "NAND");
  assert.deepEqual(definition.pins, { A1: "input", A2: "input", ZN: "output" });
  assert.match(html, /value="NAND" selected/);
  assert.match(html, /data-cell-config-pin="ZN"[\s\S]*?<option value="output" selected/);
});

test("pasted design input rejects text without a module", () => {
  assert.equal(parseDesignSource("module m(input a, output y); assign y = a; endmodule").modules[0].name, "m");
  assert.throws(() => parseDesignSource("this is not a netlist"), /No module declarations found/);
});
