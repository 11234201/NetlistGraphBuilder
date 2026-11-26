import assert from "node:assert/strict";
import test from "node:test";
import { findCompareNode, getCompareNodeName } from "../../src/domains/netlist/compare_objects.js";
import { createCompareWorkspaceController } from "../../src/app/compare_workspace_controller.js";
import { prepareCompareWorkspace } from "../../src/app/compareWorkspace.js";
import { createAppState } from "../../src/app/appState.js";
import { DEFAULT_LAYOUT_POLICY } from "../../src/layout/layoutPolicy.js";
import { DEFAULT_LAYOUT_PROVIDER_ID } from "../../src/layout/providerDefaults.js";
import { getLayoutProvider } from "../../src/layout/layoutProvider.js";
import { parseVerilog } from "../../src/parser/verilogParser.js";
import { createRenderGeneration } from "../../src/render/renderGeneration.js";
import { createTestViewBridges } from "../helpers/view_session_bridges.js";

test("Compare selection resolves projected canonical names independently of display labels", () => {
  const cell = { id: "projected-cell", kind: "cell", label: "Friendly gate", ref: { localId: "branch/u0" } };
  const port = { id: "projected-port", kind: "output", label: "Output alias", ref: { localId: "bus[3]" } };
  const graph = { nodes: [cell, port] };
  assert.equal(getCompareNodeName(cell), "branch/u0");
  assert.equal(findCompareNode(graph, "cell", "branch/u0"), cell);
  assert.equal(findCompareNode(graph, "port", "bus[3]", "output"), port);
  assert.equal(findCompareNode(graph, "cell", "Friendly gate"), null);
  assert.equal(getCompareNodeName({ ...cell, ref: { instance: "canonical", localId: "fallback" } }), "canonical");
});

test("Compare search builds candidate roots without changing the live query on failure", async () => {
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  const moduleText = name => `module ${name}(input a, input b, output y, output z);
    BUF u0(.A(a),.Z(y)); BUF u1(.A(b),.Z(z)); endmodule`;
  state.design = parseVerilog(moduleText("left") + "\n" + moduleText("right"));
  Object.assign(state.compare, { active: true, leftModuleName: "left", rightModuleName: "right", outputName: "y" });
  const [leftModule, rightModule] = state.design.modules;
  const prepared = prepareCompareWorkspace({ leftModule, rightModule });
  state.compare.fullGraphs = prepared.fullGraphs;
  state.compare.graphs = prepared.fullGraphs;
  const bridges = createTestViewBridges(state);
  bridges.compareViewSessions.replaceRoots("left", ["cell:u0"], "cell:u0");
  bridges.compareViewSessions.replaceRoots("right", ["cell:u0"], "cell:u0");
  const originalGraphs = state.compare.graphs;
  const originalRoots = state.compare.focusedRootNodeIds;
  const failures = [];
  let execution;
  const services = new Proxy({
    ...bridges,
    renderGeneration: createRenderGeneration(),
    getCurrentLayoutProvider: () => getLayoutProvider(DEFAULT_LAYOUT_PROVIDER_ID),
    workspaceExecution: { execute(request) { execution = request; } },
    handleLayoutFailure() { assert.fail("Candidate failures must reach their owning search operation"); }
  }, { get: (target, key) => target[key] || (() => {}) });
  const controller = createCompareWorkspaceController({ state, services,
    elements: { compareMount: { querySelector: () => null } } });
  controller.renderCompareGraphs({
    focusCandidate: { outputName: null,
      focusedRootNodeIds: { left: ["cell:u0"], right: ["cell:u1"] },
      activeFocusedRootNodeId: { left: "cell:u0", right: "cell:u1" } },
    commitPath() { assert.fail("An uncommitted candidate must not change the live view"); },
    pathCurrent: () => true,
    onFailed: error => failures.push(error)
  });
  assert.ok(execution);
  const right = await execution.tasks[1].run({ signal: new AbortController().signal });
  assert.ok(right.graph.nodes.some(node => node.id === "cell:u1"));
  assert.ok(!right.graph.nodes.some(node => node.id === "cell:u0"), "Candidate must not reuse the old roots or output cone");
  const failure = new Error("candidate presentation failed", { cause: new Error("original cause") });
  execution.onError(failure);
  assert.deepEqual(failures, [failure]);
  assert.equal(state.compare.graphs, originalGraphs);
  assert.equal(state.compare.focusedRootNodeIds, originalRoots);
  assert.equal(state.compare.outputName, "y");
});
