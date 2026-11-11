import assert from "node:assert/strict";
import test from "node:test";
import { parseVerilog } from "../../src/parser/verilogParser.js";
import { buildWorkspaceGraph, selectWorkspaceGraphView, applyWorkspaceGraphTransforms } from "../../src/app/graphWorkspace.js";
import { buildModuleWorkspace } from "../../src/app/moduleWorkspace.js";
import { buildCompareWorkspace } from "../../src/app/compareWorkspace.js";
import { getLayoutProvider } from "../../src/layout/layoutProvider.js";
import { DEFAULT_LAYOUT_PROVIDER_ID } from "../../src/layout/providerDefaults.js";
import { validateLayoutGraph } from "../../src/layout/layoutValidator.js";

const module = parseVerilog(`module aliases(input d,output y0,y1,y2,y3);
  wire n,a,b,p0,p1; assign a=n; assign b=a;
  BUFX1 driver(.A(d),.Y(n));
  BUFX1 inside_n(.A(n),.Y(p0)); BUFX1 root0(.A(p0),.Y(y0));
  BUFX1 inside_a(.A(a),.Y(p1)); BUFX1 root1(.A(p1),.Y(y1));
  BUFX1 outside_b(.A(b),.Y(y2)); BUFX1 outside_n(.A(n),.Y(y3)); endmodule`).modules[0];
const roots = ["cell:root0", "cell:root1"];
const query = { viewMode: "focused", rootNodeIds: roots, faninDepth: 1, fanoutDepth: 1 };
const outputs = (graph) => graph.nodes.filter((node) => node.kind === "focus-output");
const hiddenTargets = (graph) => outputs(graph).flatMap((node) => node.hiddenEndpointIds).sort();

test("folded alias chains retain every hidden fanout once across multiple visible aliases", () => {
  const full = buildWorkspaceGraph(module);
  const before = structuredClone(full);
  const graph = selectWorkspaceGraphView(full, query);
  assert.deepEqual(hiddenTargets(graph), ["cell:outside_b", "cell:outside_n"]);
  const branches = graph.edges.filter((edge) => edge.focusBoundaryDirection === "out");
  const lineage = branches.flatMap((edge) => edge.derivedFromEdgeIds);
  assert.equal(new Set(lineage).size, lineage.length);
  assert.equal(lineage.length, 2);
  for (const edge of branches) {
    const input = graph.nodes.find((node) => node.id === edge.source);
    assert.equal(input.kind, "focus-input");
    assert.equal(edge.net, input.ref.name);
    assert.equal(edge.sourcePin, input.label);
  }
  assert.deepEqual(full, before);
  const boundarySignature = (value) => ({
    nodes: value.nodes.filter((node) => node.boundaryDirection),
    edges: value.edges.filter((edge) => edge.focusBoundaryDirection)
  });
  assert.deepEqual(boundarySignature(selectWorkspaceGraphView({ ...full,
    nodes: full.nodes.toReversed(), edges: full.edges.toReversed(), aliases: full.aliases.toReversed()
  }, { ...query, rootNodeIds: roots.toReversed() })), boundarySignature(graph));
  assert.deepEqual(hiddenTargets(selectWorkspaceGraphView(full, { ...query, rootNodeIds: [roots[0]] })),
    ["cell:inside_a", "cell:outside_b", "cell:outside_n"]);
});

test("alias fanout continuations route in Single and Compare without foreign-net overlap", async () => {
  const options = { module, layoutProvider: getLayoutProvider(DEFAULT_LAYOUT_PROVIDER_ID),
    viewMode: "focused", focusedRootNodeIds: roots, faninDepth: 1, fanoutDepth: 1 };
  const single = await buildModuleWorkspace(options);
  const compare = await buildCompareWorkspace({ ...options, leftModule: module, rightModule: module,
    focusedRootNodeIds: { left: roots, right: roots } });
  for (const graph of [single.graph, compare.graphs.left, compare.graphs.right]) {
    assert.deepEqual(hiddenTargets(graph), ["cell:outside_b", "cell:outside_n"]);
    assert.deepEqual(validateLayoutGraph(graph), []);
    assert.ok(graph.edges.every((edge) => edge.points.length >= 2));
  }
});

test("alias continuations honor visible assigns, direction, routing exclusions and Simple freeze", async () => {
  const full = buildWorkspaceGraph(module);
  assert.deepEqual(hiddenTargets(selectWorkspaceGraphView(full, { ...query, fanoutDepth: 0 })),
    ["cell:outside_b", "cell:outside_n"]);
  for (const net of ["n", "a", "b"]) {
    const hidden = applyWorkspaceGraphTransforms(selectWorkspaceGraphView(full, query), { fullGraph: full, unroutedNets: [net] });
    assert.equal(hidden.nodes.some((node) => node.boundaryDirection), false);
  }
  const explicit = selectWorkspaceGraphView(buildWorkspaceGraph(module, { showAliases: true }), query);
  assert.ok(hiddenTargets(explicit).includes("assign:a:n"));
  assert.equal(hiddenTargets(explicit).includes("cell:outside_b"), false);
  const simple = await buildModuleWorkspace({ module, layoutProvider: getLayoutProvider("simple-layered"),
    viewMode: "focused", focusedRootNodeIds: roots, faninDepth: 1, fanoutDepth: 1 });
  assert.equal(outputs(simple.sourceGraph).length, 0);
});

test("equal constant assignments never become alias fanout continuations", () => {
  const constants = parseVerilog(`module constants(output y,z); wire a,b,p;
    assign a=1'b0; assign b=1'b0;
    BUFX1 inside(.A(a),.Y(p)); BUFX1 root(.A(p),.Y(y)); BUFX1 outside(.A(b),.Y(z)); endmodule`).modules[0];
  const graph = selectWorkspaceGraphView(buildWorkspaceGraph(constants), { ...query, rootNodeIds: ["cell:root"] });
  assert.ok(graph.nodes.some((node) => node.kind === "focus-input" && node.ref.name === "a"));
  assert.equal(outputs(graph).length, 0);
});

test("escaped hierarchical aliases keep fanout and canonical wire identities", async () => {
  const escaped = parseVerilog(`module escaped(input d,output y,z); wire n,p,\\cluster/clk[0] ;
    assign \\cluster/clk[0] =n;
    BUFX1 driver(.A(d),.Y(n)); BUFX1 inside(.A(n),.Y(p));
    BUFX1 root(.A(p),.Y(y)); BUFX1 outside(.A(\\cluster/clk[0] ),.Y(z)); endmodule`).modules[0];
  const workspace = await buildModuleWorkspace({ module: escaped, layoutProvider: getLayoutProvider(DEFAULT_LAYOUT_PROVIDER_ID),
    viewMode: "focused", focusedRootNodeIds: ["cell:root"], faninDepth: 1, fanoutDepth: 1 });
  assert.deepEqual(hiddenTargets(workspace.graph), ["cell:outside"]);
  assert.equal(outputs(workspace.graph)[0].ref.name, "n");
  assert.deepEqual(validateLayoutGraph(workspace.graph), []);
});
