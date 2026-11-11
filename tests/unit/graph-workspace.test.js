import assert from "node:assert/strict";
import test from "node:test";
import {
  applyWorkspaceGraphTransforms,
  buildWorkspaceGraph,
  resolveCellConfigRefreshView,
  selectWorkspaceGraphView,
  shouldUseSearchFirst
} from "../../src/app/graphWorkspace.js";
import { parseVerilog } from "../../src/parser/verilogParser.js";
import { buildModuleWorkspace } from "../../src/app/moduleWorkspace.js";
import { buildCompareWorkspace } from "../../src/app/compareWorkspace.js";
import { getLayoutProvider } from "../../src/layout/layoutProvider.js";
import { DEFAULT_LAYOUT_PROVIDER_ID } from "../../src/layout/providerDefaults.js";
import { validateLayoutGraph } from "../../src/layout/layoutValidator.js";

const source = `module top (a, y0, y1); input a; output y0, y1;
BUF u0 (.A(a), .Y(y0)); BUF u1 (.A(a), .Y(y1)); endmodule`;

test("shared graph workspace prepares whole and focused views without mutation", () => {
  const module = parseVerilog(source).modules[0];
  const fullGraph = buildWorkspaceGraph(module, { moduleLibrary: [module] });
  const focused = selectWorkspaceGraphView(fullGraph, {
    viewMode: "focused",
    rootNodeId: "cell:u0",
    faninDepth: 1,
    fanoutDepth: 0
  });

  assert.ok(fullGraph.nodes.some((node) => node.id === "cell:u1"));
  assert.equal(focused.nodes.some((node) => node.id === "cell:u1"), false);
  assert.ok(focused.nodes.some((node) => node.id === "cell:u0"));
});

test("workspace graph carries occurrence context into ObjectRef-capable nodes", () => {
  const module = parseVerilog(`module top (a, y); input a; output y; BUF u0 (.A(a), .Z(y)); endmodule`).modules[0];
  const graph = buildWorkspaceGraph(module, { occurrencePath: ["top", "u0:BUF"] });
  assert.deepEqual(graph.nodes.find((node) => node.id === "cell:u0").ref.occurrencePath, ["top", "u0:BUF"]);
});

test("large module policy enters search-first only above its stable threshold", () => {
  assert.equal(shouldUseSearchFirst({ cells: Array.from({ length: 500 }) }), false);
  assert.equal(shouldUseSearchFirst({ cells: Array.from({ length: 501 }) }), true);
  assert.equal(shouldUseSearchFirst({ nodes: Array.from({ length: 1024 }) }, 500), true);
});

test("Cell Config refresh avoids whole-layout work for a large selected cell", () => {
  const largeModule = { cells: Array.from({ length: 501 }) };
  const fullGraph = { nodes: [{ id: "cell:u42", kind: "cell" }] };
  assert.deepEqual(resolveCellConfigRefreshView({
    module: largeModule,
    fullGraph,
    selectedNodeId: "cell:u42",
    viewMode: "whole"
  }), { viewMode: "focused", coneRootNodeId: "cell:u42" });
  assert.deepEqual(resolveCellConfigRefreshView({
    module: largeModule,
    fullGraph,
    selectedNodeId: null,
    viewMode: "whole"
  }), { viewMode: "search-first", coneRootNodeId: null });
});

test("shared display transforms can be disabled independently", () => {
  const module = parseVerilog(source).modules[0];
  const graph = buildWorkspaceGraph(module, { moduleLibrary: [module] });
  const unchanged = applyWorkspaceGraphTransforms(graph, {
    useFanoutHubs: false,
    collapseLargeGroups: false
  });
  const simplified = applyWorkspaceGraphTransforms(graph, {
    useFanoutHubs: true,
    collapseLargeGroups: false
  });

  assert.equal(unchanged, graph);
  assert.ok(simplified.nodes.length >= graph.nodes.length);
});

test("large-group collapse is opt-in by default", () => {
  const graph = {
    nodes: Array.from({ length: 301 }, (_, index) => ({
      id: `cell:u${index}`,
      kind: "cell",
      label: `u${index}`
    })),
    edges: []
  };

  const defaultView = applyWorkspaceGraphTransforms(graph, { useFanoutHubs: false });
  const collapsedView = applyWorkspaceGraphTransforms(graph, {
    useFanoutHubs: false,
    collapseLargeGroups: true
  });

  assert.equal(defaultView, graph);
  assert.equal(defaultView.nodes.length, 301);
  assert.equal(collapsedView.collapsedGroupCount, 7);
  assert.ok(collapsedView.nodes.some((node) => node.kind === "group"));
});

test("search-first and focused views derive from the full graph without mutation", () => {
  const module = parseVerilog(source).modules[0];
  const fullGraph = buildWorkspaceGraph(module, { moduleLibrary: [module] });
  const empty = selectWorkspaceGraphView(fullGraph, { viewMode: "search-first" });
  const focused = selectWorkspaceGraphView(fullGraph, {
    viewMode: "focused",
    rootNodeId: "cell:u0",
    faninDepth: 1,
    fanoutDepth: 1
  });
  assert.equal(empty.nodes.length, 0);
  assert.equal(empty.view.totalNodes, fullGraph.nodes.length);
  assert.ok(focused.nodes.some((node) => node.id === "cell:u0"));
  assert.equal(fullGraph.view, undefined);
  assert.ok(fullGraph.nodes.length > focused.nodes.length);
});

test("focused views project depth cut edges into explicit boundary nodes", () => {
  const module = parseVerilog(
    "module chain(a, y); input a; output y; wire n; BUF u0 (.A(a), .Y(n)); BUF u1 (.A(n), .Y(y)); endmodule"
  ).modules[0];
  const fullGraph = buildWorkspaceGraph(module, { moduleLibrary: [module] });
  const focused = selectWorkspaceGraphView(fullGraph, {
    viewMode: "focused",
    rootNodeIds: ["cell:u0"],
    faninDepth: 0,
    fanoutDepth: 1
  });

  assert.ok(focused.nodes.some((node) => node.kind === "focus-output" && node.label === "y"));
  assert.ok(focused.edges.some((edge) => edge.focusBoundaryDirection === "out"));
  assert.equal(focused.nodes.some((node) => node.id === "output:y"), false);
  assert.ok(fullGraph.nodes.some((node) => node.id === "output:y"));

  const upstream = selectWorkspaceGraphView(fullGraph, {
    viewMode: "focused",
    rootNodeIds: ["cell:u1"],
    faninDepth: 1,
    fanoutDepth: 0
  });
  assert.ok(upstream.nodes.some((node) => node.kind === "focus-input" && node.label === "a"));
  assert.ok(upstream.edges.some((edge) => edge.focusBoundaryDirection === "in"));
  assert.equal(upstream.nodes.some((node) => node.id === "input:a"), false);
});

const sharedFanoutModule = parseVerilog(`module fanout(input d, output y,z,w);
  wire n,n1,n2; BUFX1 driver(.A(d),.Y(n));
  BUFX1 a(.A(n),.Y(n1)); BUFX1 b(.A(n),.Y(n2)); BUFX1 outside(.A(n),.Y(w));
  BUFX1 ra(.A(n1),.Y(y)); BUFX1 rb(.A(n2),.Y(z)); endmodule`).modules[0];
const sharedFanoutOptions = { viewMode: "focused", rootNodeIds: ["cell:ra", "cell:rb"], faninDepth: 1, fanoutDepth: 1 };

test("multiple Focused roots preserve hidden fanout from a shared external driver", () => {
  const full = buildWorkspaceGraph(sharedFanoutModule);
  const before = structuredClone(full);
  const graph = selectWorkspaceGraphView(full, sharedFanoutOptions);
  const input = graph.nodes.find((node) => node.kind === "focus-input" && node.ref.name === "n");
  const output = graph.nodes.find((node) => node.kind === "focus-output" && node.ref.name === "n");
  assert.ok(input && output);
  assert.deepEqual(output.hiddenEndpointIds, ["cell:outside"]);
  assert.equal(graph.nodes.some((node) => ["cell:driver", "cell:outside"].includes(node.id)), false);
  assert.ok(graph.edges.some((edge) => edge.source === input.id && edge.target === output.id && edge.net === "n"));
  assert.deepEqual(full, before);
  const boundarySignature = (value) => ({
    nodes: value.nodes.filter((node) => node.boundaryDirection),
    edges: value.edges.filter((edge) => edge.focusBoundaryDirection)
  });
  assert.deepEqual(boundarySignature(selectWorkspaceGraphView({ ...full, nodes: full.nodes.toReversed(), edges: full.edges.toReversed() },
    { ...sharedFanoutOptions, rootNodeIds: sharedFanoutOptions.rootNodeIds.toReversed() })), boundarySignature(graph));
});

test("fanout continuations respect depth, budgets, visible loads and routing exclusions", () => {
  const full = buildWorkspaceGraph(sharedFanoutModule);
  const outputForN = (graph) => graph.nodes.find((node) => node.kind === "focus-output" && node.ref.name === "n");
  assert.equal(outputForN(selectWorkspaceGraphView(full, { ...sharedFanoutOptions, fanoutDepth: 0 })), undefined);
  assert.equal(outputForN(selectWorkspaceGraphView(full, { ...sharedFanoutOptions, rootNodeIds: ["cell:a", "cell:b", "cell:outside"], faninDepth: 0 })), undefined);
  const visibleDriver = selectWorkspaceGraphView(full, { ...sharedFanoutOptions, faninDepth: 2 });
  assert.ok(visibleDriver.nodes.some((node) => node.id === "cell:driver"));
  assert.deepEqual(outputForN(visibleDriver).hiddenEndpointIds, ["cell:outside"]);
  const budgeted = selectWorkspaceGraphView(full, { ...sharedFanoutOptions, maximumVisibleNodes: 3 });
  assert.ok(outputForN(budgeted).hiddenEndpointIds.includes("cell:outside"));
  const allLoads = selectWorkspaceGraphView(full, { ...sharedFanoutOptions, rootNodeIds: ["cell:ra", "cell:rb", "cell:outside"] });
  assert.equal(outputForN(allLoads), undefined);
  const omitted = applyWorkspaceGraphTransforms(selectWorkspaceGraphView(full, sharedFanoutOptions), { fullGraph: full, unroutedNets: ["n"] });
  assert.equal(omitted.nodes.some((node) => node.boundaryDirection && node.ref.name === "n"), false);
});

test("Single and Compare route the same external fanout continuation", async () => {
  const layoutProvider = getLayoutProvider(DEFAULT_LAYOUT_PROVIDER_ID);
  const options = { module: sharedFanoutModule, layoutProvider, viewMode: "focused", focusedRootNodeIds: sharedFanoutOptions.rootNodeIds, faninDepth: 1, fanoutDepth: 1 };
  const single = await buildModuleWorkspace(options);
  const compare = await buildCompareWorkspace({ ...options, leftModule: sharedFanoutModule, rightModule: sharedFanoutModule,
    focusedRootNodeIds: { left: sharedFanoutOptions.rootNodeIds, right: sharedFanoutOptions.rootNodeIds } });
  for (const graph of [single.graph, compare.graphs.left, compare.graphs.right]) {
    assert.ok(graph.nodes.some((node) => node.kind === "focus-output" && node.ref.name === "n"));
    assert.deepEqual(validateLayoutGraph(graph), []);
  }
});

test("Simple retains its frozen Focused source projection", async () => {
  const fullGraph = buildWorkspaceGraph(sharedFanoutModule);
  const legacy = selectWorkspaceGraphView(fullGraph, { ...sharedFanoutOptions, preserveLegacyProjection: true });
  const simple = await buildModuleWorkspace({ module: sharedFanoutModule, preparedFullGraph: fullGraph,
    layoutProvider: getLayoutProvider("simple-layered"), viewMode: "focused", focusedRootNodeIds: sharedFanoutOptions.rootNodeIds,
    faninDepth: 1, fanoutDepth: 1, useFanoutHubs: false });
  assert.deepEqual(simple.sourceGraph.nodes.map((node) => node.id).sort(), legacy.nodes.map((node) => node.id).sort());
  assert.deepEqual(simple.sourceGraph.edges, legacy.edges);
});

test("many Focused roots retain external fanout through the high-fanout hub transform", async () => {
  const source = `module fanout(input d); wire n; BUFX1 driver(.A(d),.Y(n));
    ${Array.from({ length: 20 }, (_, index) => `wire n${index},y${index};
      BUFX1 a${index}(.A(n),.Y(n${index})); BUFX1 r${index}(.A(n${index}),.Y(y${index}));`).join("\n")}
    endmodule`;
  const module = parseVerilog(source).modules[0];
  const workspace = await buildModuleWorkspace({ module, layoutProvider: getLayoutProvider(DEFAULT_LAYOUT_PROVIDER_ID),
    viewMode: "focused", focusedRootNodeIds: Array.from({ length: 12 }, (_, index) => `cell:r${index}`),
    faninDepth: 1, fanoutDepth: 1, useFanoutHubs: true });
  const graph = workspace.graph;
  const boundary = graph.nodes.find((node) => node.kind === "focus-output" && node.ref.name === "n");
  assert.equal(boundary.hiddenEndpointCount, 8);
  assert.ok(graph.nodes.some((node) => node.kind === "hub" && node.ref.name === "n"));
  assert.ok(graph.edges.some((edge) => edge.target === boundary.id && edge.points.length >= 2));
  assert.equal(graph.nodes.some((node) => node.id === "cell:a12"), false);
  assert.deepEqual(validateLayoutGraph(graph), []);
});
