import assert from "node:assert/strict";
import test from "node:test";
import { parseVerilog } from "../../src/parser/verilogParser.js";
import { inspectGraphNet } from "../../src/analysis/graphInspector.js";
import { buildWorkspaceGraph, selectWorkspaceGraphView } from "../../src/app/graphWorkspace.js";
import { buildModuleWorkspace } from "../../src/app/moduleWorkspace.js";
import { buildCompareWorkspace } from "../../src/app/compareWorkspace.js";
import { getLayoutProvider } from "../../src/layout/layoutProvider.js";
import { DEFAULT_LAYOUT_PROVIDER_ID } from "../../src/layout/providerDefaults.js";
import { ElkLayoutProvider } from "../../src/layout/elkLayoutProvider.js";
import { validateLayoutGraph } from "../../src/layout/layoutValidator.js";
import { renderSchematicSvg } from "../../src/domains/netlist/netlist_scene.js";
import Elk from "../../vendor/elkjs-0.11.1/lib/elk.bundled.js";

const source = `module exact(input d,output y,z);wire n,a,b;
  BUFX1 driver(.A(d),.Y(n)); BUFX1 inside_a(.A(n),.Y(a)); BUFX1 inside_b(.A(n),.Y(b));
  AND2X1 root(.A(a),.B(b),.Y(y)); BUFX1 outside(.A(n),.Y(z)); endmodule`;
const module = parseVerilog(source).modules[0];
const query = { viewMode: "focused", rootNodeIds: ["cell:root"], faninDepth: 2, fanoutDepth: 0 };
const boundaryFor = (graph, name = "n") => graph.nodes.find((node) => node.kind === "focus-output" && node.ref.name === name);
const realIds = (graph) => graph.nodes.filter((node) => !node.boundaryDirection).map((node) => node.id).sort();

test("zero fanout depth keeps the third load as a boundary without expanding the fanin cone", () => {
  const full = buildWorkspaceGraph(module);
  const before = structuredClone(full);
  assert.equal(inspectGraphNet(full, "n").summary.find(([label]) => label === "Fanout")[1], 3);
  for (const rootNodeIds of [["cell:root"], ["cell:inside_a", "cell:inside_b"]]) {
    const options = { ...query, rootNodeIds };
    const graph = selectWorkspaceGraphView(full, options);
    const legacy = selectWorkspaceGraphView(full, { ...options, preserveLegacyProjection: true });
    assert.deepEqual(realIds(graph), realIds(legacy));
    assert.ok(graph.nodes.some((node) => node.id === "cell:driver"));
    assert.equal(graph.nodes.some((node) => node.id === "cell:outside"), false);
    assert.deepEqual(boundaryFor(graph).hiddenEndpointIds, ["cell:outside"]);
    assert.equal(graph.edges.filter((edge) => edge.net === "n").length, 3);
    const reversed = selectWorkspaceGraphView({ ...full, nodes: full.nodes.toReversed(), edges: full.edges.toReversed() },
      { ...options, rootNodeIds: rootNodeIds.toReversed() });
    assert.deepEqual(boundaryFor(reversed), boundaryFor(graph));
    assert.deepEqual(reversed.edges.filter((edge) => edge.focusBoundaryDirection === "out"),
      graph.edges.filter((edge) => edge.focusBoundaryDirection === "out"));
  }
  assert.deepEqual(full, before);
});

test("zero-depth continuation is routed and exported by Single, Compare and ELK", async () => {
  const options = { module, layoutProvider: getLayoutProvider(DEFAULT_LAYOUT_PROVIDER_ID),
    viewMode: "focused", focusedRootNodeIds: query.rootNodeIds, faninDepth: 2, fanoutDepth: 0 };
  const single = await buildModuleWorkspace(options);
  const compare = await buildCompareWorkspace({ ...options, leftModule: module, rightModule: module,
    focusedRootNodeIds: { left: query.rootNodeIds, right: query.rootNodeIds } });
  const elk = await buildModuleWorkspace({ ...options, layoutProvider: new ElkLayoutProvider({ elkFactory: () => new Elk() }) });
  for (const graph of [single.graph, compare.graphs.left, compare.graphs.right, elk.graph]) {
    const boundary = boundaryFor(graph);
    assert.deepEqual(boundary.hiddenEndpointIds, ["cell:outside"]);
    assert.ok(graph.edges.find((edge) => edge.target === boundary.id).points.length >= 2);
    assert.deepEqual(validateLayoutGraph(graph), []);
    assert.ok(renderSchematicSvg(graph).includes(`data-node-id="${boundary.id}"`));
  }
});

test("zero-depth continuations also retain a hidden load using a folded alias", async () => {
  const aliasModule = parseVerilog(source.replace("wire n,a,b;", "wire n,a,b,alias_n; assign alias_n=n;")
    .replace("outside(.A(n)", "outside(.A(alias_n)")).modules[0];
  for (const fanoutDepth of [0, 1]) {
    const workspace = await buildModuleWorkspace({ module: aliasModule, layoutProvider: getLayoutProvider(DEFAULT_LAYOUT_PROVIDER_ID),
      viewMode: "focused", focusedRootNodeIds: query.rootNodeIds, faninDepth: 2, fanoutDepth });
    assert.deepEqual(boundaryFor(workspace.graph).hiddenEndpointIds, ["cell:outside"]);
    assert.equal(workspace.graph.nodes.some((node) => node.id === "cell:outside"), false);
    assert.deepEqual(validateLayoutGraph(workspace.graph), []);
  }
});

test("zero-depth continuation respects net exclusions, unseen nets and frozen Simple", async () => {
  const options = { module, viewMode: "focused", focusedRootNodeIds: query.rootNodeIds, faninDepth: 2, fanoutDepth: 0 };
  const hidden = await buildModuleWorkspace({ ...options, layoutProvider: getLayoutProvider(DEFAULT_LAYOUT_PROVIDER_ID),
    graphOverrides: { unroutedNets: ["n"] } });
  assert.equal(boundaryFor(hidden.graph), undefined);
  assert.equal(hidden.graph.edges.some((edge) => edge.net === "n"), false);
  assert.ok(hidden.graph.nodes.some((node) => node.id === "cell:driver"));
  const simple = await buildModuleWorkspace({ ...options, layoutProvider: getLayoutProvider("simple-layered") });
  assert.equal(boundaryFor(simple.graph), undefined);
  assert.equal(simple.graph.edges.filter((edge) => edge.net === "n").length, 2);
  const isolated = selectWorkspaceGraphView(buildWorkspaceGraph(module), {
    ...query, rootNodeIds: ["cell:driver"], faninDepth: 0
  });
  assert.equal(boundaryFor(isolated), undefined);
});
