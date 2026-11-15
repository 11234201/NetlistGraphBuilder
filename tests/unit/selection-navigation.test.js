import assert from "node:assert/strict";
import test from "node:test";
import { createAppState } from "../../src/app/appState.js";
import { createSelectionNavigationController } from "../../src/app/selection_navigation_controller.js";
import { createSingleViewSessionBridge } from "../../src/app/single_view_session_bridge.js";
import { DEFAULT_LAYOUT_POLICY } from "../../src/layout/layoutPolicy.js";
import { parseVerilog } from "../../src/parser/verilogParser.js";
import { buildWorkspaceGraph } from "../../src/domains/netlist/netlist_graph_projection.js";

function setup() {
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  state.design = parseVerilog("module top(input a, output y,z); BUF u(.A(a),.Y(y)); BUF v(.A(a),.Y(z)); endmodule module peer(input a, output y); BUF w(.A(a),.Y(y)); endmodule");
  state.currentModule = state.design.modules[0];
  state.document = { documentId: "navigation" };
  state.fullGraph = buildWorkspaceGraph(state.currentModule);
  state.graph = { ...state.fullGraph, nodes: state.fullGraph.nodes.filter((node) => node.id !== "cell:v") };
  state.singleWorkspaceIdentity = "committed";
  const bridge = createSingleViewSessionBridge({ state, getDocumentId: () => state.document.documentId });
  bridge.importNavigation({ viewMode: "focused", focusedRootNodeIds: ["cell:u"] });
  const events = [];
  let controller;
  const services = {
    singleViewSession: bridge,
    sameOccurrencePath: (left, right) => JSON.stringify(left) === JSON.stringify(right),
    runViewHistoryTransaction(metadata, operation) { events.push(["history", metadata.label]); return operation(); },
    selectModule(name, options) {
      events.push(["module", name, options]);
      state.currentModule = state.design.modules.find((module) => module.name === name);
      state.occurrenceContext = { rootModuleName: options.rootModuleName, occurrencePath: options.occurrencePath };
      state.fullGraph = buildWorkspaceGraph(state.currentModule, { occurrencePath: options.occurrencePath });
    },
    renderCurrentModuleGraph(options) {
      events.push(["render", state.currentModule.name, structuredClone(bridge.readState().focusedRootRefs)]);
      state.graph = state.fullGraph;
      options.onRendered(state.graph);
    },
    setSingleTransform: (viewport) => bridge.dispatch({ type: "viewport.set", viewport }),
    schematicSelectionController: {
      selectNode: (id) => controller.handleSingleNodeSelection(id),
      selectNet: (name) => controller.handleSingleNetSelection(name)
    },
    renderSelection() {}, renderNetSelection() {}, updateViewControls() {},
    centerGraphPoint() {}, getEdgeCenter: () => ({ x: 0, y: 0 }), commitViewHistory() {}, setStatus() {}
  };
  controller = createSelectionNavigationController({ state, elements: {}, services });
  return { state, bridge, controller, events };
}

test("connection navigation reveals a hidden cell through Focused and keeps existing roots", () => {
  const h = setup();
  h.controller.navigateSingleSelectionTarget({ kind: "node", id: "cell:v" });
  assert.equal(h.state.viewMode, "focused");
  assert.deepEqual(h.state.focusedRootNodeIds, ["cell:u", "cell:v"]);
  assert.equal(h.state.selectedNodeId, "cell:v");
  assert.equal(h.events.filter(([type]) => type === "render").length, 1);
});

for (const target of [
  { moduleName: "peer", rootModuleName: "top", occurrencePath: ["child"] },
  { moduleName: "top", rootModuleName: "top", occurrencePath: ["recursive"] },
  { moduleName: "top", rootModuleName: "other", occurrencePath: [] }
]) {
  test(`net navigation changes occurrence before its only render: ${JSON.stringify(target)}`, () => {
    const h = setup();
    h.controller.navigateSingleSelectionTarget({ kind: "net", name: "a", ...target });
    assert.deepEqual(h.events.map(([type]) => type), ["history", "module", "render"]);
    assert.deepEqual(h.events[1][2], { rootModuleName: target.rootModuleName, occurrencePath: target.occurrencePath, deferRender: true });
    assert.deepEqual(h.events[2][2].map(({ kind, localId, occurrencePath }) => ({ kind, localId, occurrencePath })),
      [{ kind: "net", localId: "a", occurrencePath: target.occurrencePath.length ? target.occurrencePath : undefined }]);
    assert.equal(h.state.viewMode, "focused");
    assert.equal(h.state.selectedNet, "a");
    assert.equal(h.controller.selectionTargetChangesHierarchyContext(target), false);
  });
}
