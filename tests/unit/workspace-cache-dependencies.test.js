import assert from "node:assert/strict";
import test from "node:test";
import { parseVerilog } from "../../src/parser/verilogParser.js";
import { buildModuleWorkspace, buildModuleFullGraph } from "../../src/app/moduleWorkspace.js";
import { buildCompareWorkspace, prepareCompareWorkspace } from "../../src/app/compareWorkspace.js";
import { createWorkspaceArtifactCache } from "../../src/app/workspaceArtifactCache.js";
import { getLayoutProvider } from "../../src/layout/layoutProvider.js";
import { parseTimingLog } from "../../src/timing/timingParser.js";

const source = "module top(input a, output y); wire n; assign n=a; BUF u (.A(n),.Y(y)); endmodule";
function setup() {
  const module = parseVerilog(source).modules[0];
  const base = getLayoutProvider("simple-layered");
  let calls = 0;
  return {
    calls: () => calls,
    options: { module, moduleLibrary: [module], useFanoutHubs: false,
      layoutProvider: { id: base.id, layout(...args) { calls++; return base.layout(...args); } },
      artifactCache: createWorkspaceArtifactCache(),
      artifactIdentity: { documentId: "d", sourceRevision: 1, sessionId: "s" } }
  };
}

test("automatic artifacts follow alias and occurrence graph dependencies while reusing unchanged graphs", () => {
  const { options, calls } = setup();
  const first = buildModuleWorkspace(options);
  assert.equal(buildModuleWorkspace(options).autoGraph, first.autoGraph);
  assert.equal(calls(), 1);
  const aliases = buildModuleWorkspace({ ...options, showAliases: true });
  assert.ok(aliases.graph.nodes.some((node) => node.kind === "assign"));
  assert.notEqual(aliases.autoGraph, first.autoGraph);
  const occurrence = buildModuleWorkspace({ ...options, occurrencePath: ["u_child"] });
  assert.deepEqual(occurrence.graph.nodes.find((node) => node.id === "cell:u").ref.occurrencePath, ["u_child"]);
  assert.equal(calls(), 3);
});

test("replacement prepared graphs and same-id providers invalidate automatic artifacts", () => {
  const { options, calls } = setup();
  const first = buildModuleWorkspace(options);
  const preparedFullGraph = { ...first.fullGraph, nodes: first.fullGraph.nodes.map((node) => ({ ...node, label: "changed" })) };
  const changed = buildModuleWorkspace({ ...options, preparedFullGraph });
  assert.ok(changed.graph.nodes.every((node) => node.label === "changed"));
  assert.equal(calls(), 2);
  buildModuleWorkspace({ ...options, layoutProvider: { ...options.layoutProvider } });
  assert.equal(calls(), 3);
});

test("graph overrides, cell definitions and timing invalidate warmed geometry and annotations", () => {
  for (const changes of [
    { graphOverrides: { nodeProperties: { "cell:u": { label: "renamed buffer" } } } },
    { cellConfig: { kind: "netlist-cell-config", version: 1, cells: { BUF: { gateKind: "INV", pins: { A: "input", Y: "output" } } } } },
    { timing: parseTimingLog("@module top\npoint at rt slack\ny 1 2 1") }
  ]) {
    const { options, calls } = setup();
    const first = buildModuleWorkspace(options);
    const changed = buildModuleWorkspace({ ...options, ...changes });
    assert.equal(calls(), 2);
    assert.notEqual(changed.autoGraph, first.autoGraph);
    const fresh = buildModuleWorkspace({ ...options, ...changes, artifactCache: null });
    assert.deepEqual(changed.graph.nodes, fresh.graph.nodes);
    assert.deepEqual(changed.graph.edges, fresh.graph.edges);
  }
});

test("Compare cache follows prepared graph changes without mutating cached source graphs", () => {
  const { options, calls } = setup();
  const compare = { ...options, leftModule: options.module, rightModule: options.module, forceWhole: true };
  const published = buildModuleFullGraph({ ...options, artifactIdentity: {
    ...options.artifactIdentity, sessionId: "compare:left", unitId: options.module.name
  } });
  published.nodes.forEach(Object.freeze);
  const first = buildCompareWorkspace(compare);
  const sourceGraphs = options.artifactCache.keys().filter((key) => key.includes('"stage":"full-graph"'))
    .map((key) => options.artifactCache.get(key));
  const before = sourceGraphs.map((graph) => structuredClone(graph));
  const repeated = buildCompareWorkspace(compare);
  assert.equal(repeated.autoGraphs.left, first.autoGraphs.left);
  assert.equal(calls(), 2);
  const changed = buildCompareWorkspace({ ...compare, showAliases: true });
  assert.ok(changed.graphs.left.nodes.some((node) => node.kind === "assign"));
  assert.ok(changed.graphs.right.nodes.some((node) => node.kind === "assign"));
  prepareCompareWorkspace(compare);
  sourceGraphs.forEach((graph, index) => assert.deepEqual(graph, before[index]));
});
