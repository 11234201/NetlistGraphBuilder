import test from "node:test";
import assert from "node:assert/strict";
import { createNetlistReconvergenceScope, sameNetlistReconvergenceScope } from "../../src/domains/netlist/reconvergence_scope.js";
import { createNetlistStructureIndex, analyzeNetlistReconvergence } from "../../src/domains/netlist/reconvergence_analysis.js";
import { buildWorkspaceGraph } from "../../src/domains/netlist/netlist_graph_projection.js";
import { queryNetlistView } from "../../src/domains/netlist/netlist_view_query.js";
import { parseVerilog } from "../../src/parser/verilogParser.js";
import { normalizeStructurePolicy } from "../../src/analysis/structure_policy.js";
import { readReconvergenceDetail } from "../../src/analysis/reconvergence.js";
import { analyzeAigStructure } from "../../src/domains/aig/structure_analysis.js";
import { createArtifactStore } from "../../src/application/artifact_store.js";
import { buildModuleWorkspace } from "../../src/app/moduleWorkspace.js";
import { getLayoutProvider } from "../../src/layout/layoutProvider.js";
import { DEFAULT_LAYOUT_PROVIDER_ID } from "../../src/layout/providerDefaults.js";
import { parseLiberty } from "../../src/parser/liberty_parser.js";
import { buildLibertyModel } from "../../src/infer/liberty_model.js";

function parse(source) {
  const { modules } = parseVerilog(source);
  return buildWorkspaceGraph(modules[0], { moduleLibrary: modules });
}
function run(full, visible = full, options) {
  const scope = createNetlistReconvergenceScope(full, visible);
  const index = createNetlistStructureIndex(scope.model);
  return { scope, index, ...analyzeNetlistReconvergence(index, options).reconvergence };
}
const diamond = `module top(input s, output z);
  wire p,q;
  BUF b1(.A(s),.Y(p)); INV b2(.A(s),.Y(q)); NAND2 m(.A(p),.B(q),.Y(z)); endmodule`;

test("Netlist actual Whole/Focused projections prove paths only on real visible members", () => {
  const full = parse(diamond), before = JSON.stringify(full), whole = run(full);
  assert.equal(whole.status, "complete");
  assert.equal(whole.results.length, 1);
  const [match] = whole.results;
  assert.deepEqual([match.stemId, match.mergeId], ["input:s", "cell:m"]);
  assert.deepEqual(match.paths.map((path) => path.depth), [2, 2]);
  const detail = readReconvergenceDetail(whole.index, match, normalizeStructurePolicy());
  assert.equal(detail.edgeIds.filter((id) => whole.scope.displayEdges.has(id)).length, 4);
  const { visibleGraph } = queryNetlistView(full, { mode: "focused", rootNodeIds: ["cell:b1"], faninDepth: 1, fanoutDepth: 1 });
  const clipped = run(full, visibleGraph);
  assert.deepEqual(clipped.results, []);
  assert.ok(!clipped.scope.displayNodes.has("cell:b2"));
  const { visibleGraph: unrouted } = queryNetlistView(full, { mode: "whole" }, { unroutedNets: ["q"] });
  const omitted = run(full, unrouted);
  assert.deepEqual(omitted.results, whole.results);
  assert.ok(sameNetlistReconvergenceScope(omitted.scope, whole.scope));
  assert.ok(omitted.scope.unrouted.has("q"));
  assert.equal(JSON.stringify(full), before);
});

test("cell outputs are separate fork signals, intermediate cells have one vertex capacity", () => {
  const full = parse(`module top(input s, output z);
    wire a,b,x,y,c,d;
    BUF p(.A(s),.Y(a)); INV q(.A(s),.Y(b));
    NAND2 shared(.A(a),.B(b),.Y(x),.ZN(y));
    BUF r(.A(x),.Y(c)); BUF t(.A(y),.Y(d)); NAND2 m(.A(c),.B(d),.Y(z)); endmodule`);
  const { results } = run(full);
  assert.deepEqual(results.map((item) => [item.stemId, item.mergeId]), [["input:s", "cell:shared"]]);
});

test("registered, hierarchical and black-box boundaries cut cross-cell paths", () => {
  for (const [type, suffix] of [["DFF", ""], ["CUSTOM", ""], ["child", "module child(input A, output Y); assign Y=A; endmodule"]]) {
    const full = parse(`module top(input s, output z); wire a,b;
      BUF p(.A(s),.Y(a)); ${type} boundary(.A(s),.Y(b)); NAND2 m(.A(a),.B(b),.Y(z)); endmodule ${suffix}`);
    assert.deepEqual(run(full).results, [], type);
  }
  const driven = parse(`module top(input s, output z); wire a,b;
    BUF p(.A(s),.Y(a)); BUF px(.A(s),.Y(a)); INV q(.A(s),.Y(b)); NAND2 m(.A(a),.B(b),.Y(z)); endmodule`);
  const partial = run(driven, { ...driven, nodes: driven.nodes.filter((node) => node.id !== "cell:px") });
  assert.ok(partial.reasons.includes("multiple-drivers"));
  assert.deepEqual(partial.results, []);
  assert.ok(partial.scope.visibleEdgeCount > partial.scope.displayEdges.size);
});

test("register output pins can fork; fanout hubs preserve the physical witness", () => {
  const loads = Array.from({ length: 8 }, (_, i) => "BUF spare" + i + "(.A(q),.Y(w" + i + "));").join("\n");
  const graph = parse(`module top(input s, output z); wire q,a,b;
    DFF reg1(.D(s),.Q(q)); BUF p(.A(q),.Y(a)); INV r(.A(q),.Y(b));
    NAND2 m(.A(a),.B(b),.Y(z)); ${loads} endmodule`);
  const { visibleGraph } = queryNetlistView(graph, { mode: "whole" }, { useFanoutHubs: true });
  const whole = run(graph), hubbed = run(graph, visibleGraph);
  assert.deepEqual(hubbed.results, whole.results);
  const [result] = hubbed.results;
  assert.equal(hubbed.scope.displayNodes.get(result.stemId).label, "reg1.Q");
  assert.equal(result.mergeId, "cell:m");
  assert.ok(hubbed.scope.hubs.size >= 8);
  assert.equal(hubbed.scope.model.nodes.some((node) => node.id.startsWith("hub:")), false);
});

test("cycles report partial and preserve proofs in independent components", () => {
  const full = parse(diamond.replace("endmodule", "wire x,y; BUF c1(.A(y),.Y(x)); BUF c2(.A(x),.Y(y)); endmodule"));
  const result = run(full);
  assert.equal(result.status, "partial"); assert.ok(result.reasons.includes("combinational-cycle"));
  assert.equal(result.results.length, 1);
  const reversed = run({ ...full, nodes: [...full.nodes].reverse(), edges: [...full.edges].reverse() });
  assert.deepEqual(reversed.results, result.results);
  assert.ok(sameNetlistReconvergenceScope(reversed.scope, result.scope));
  const limited = run(full, full, { reconvergenceWork: 1 });
  assert.ok(limited.reasons.includes("work-limit"));
});

test("constant aliases cannot fork even when Focused hides their source", () => {
  const { modules } = parseVerilog(diamond.replace("wire p,q;", "wire p,q,t,u; assign t=1'b0; assign u=t;").replaceAll(".A(s)", ".A(u)"));
  const graph = buildWorkspaceGraph(modules[0], { showAliases: true });
  const clipped = { ...graph, nodes: graph.nodes.filter((node) => node.kind !== "constant") };
  assert.deepEqual(run(graph, clipped).results, []);
});

test("committed Single workspace retains ambiguous driver provenance through alias folding and snapshots", async () => {
  const { modules } = parseVerilog(`module top(input s, output z); wire p,q,x,t;
    BUF a(.A(s),.Y(x)); INV b(.A(s),.Y(x)); assign t=x;
    BUF p1(.A(t),.Y(p)); INV q1(.A(t),.Y(q)); NAND2 m(.A(p),.B(q),.Y(z)); endmodule`);
  const options = { module: modules[0], occurrencePath: ["outer", "u_top"] };
  const workspace = await buildModuleWorkspace({ ...options, showAliases: false, layoutProvider: getLayoutProvider(DEFAULT_LAYOUT_PROVIDER_ID) });
  const { value } = createArtifactStore().put({ kind: "single-workspace", context: { sessionId: "single:primary" }, value: workspace });
  assert.notEqual(value.fullGraph.edges, workspace.fullGraph.edges);
  const explicit = buildWorkspaceGraph(modules[0], { showAliases: true, occurrencePath: options.occurrencePath });
  for (const result of [run(explicit), run(value.fullGraph, value.graph)]) {
    assert.ok(result.reasons.includes("multiple-drivers"));
    assert.deepEqual(result.results, []);
  }
});

test("explicit aliases retain missing and ambiguous source boundaries even when their driver is clipped", () => {
  for (const [header, issue] of [
    ["module top(inout s,output z); wire p,q,t; assign t=s;", "ambiguous-pin-direction"],
    ["module top(input s,output z); wire p,q,t,x; CUSTOM u(.A(s),.X(x)); assign t=x;", "ambiguous-pin-direction"],
    ["module top(output z); wire p,q,t,x; assign t=x;", "missing-driver"]
  ]) {
    const { modules } = parseVerilog(header + " BUF a(.A(t),.Y(p)); INV b(.A(t),.Y(q)); NAND2 m(.A(p),.B(q),.Y(z)); endmodule");
    for (const showAliases of [true, false]) {
      const graph = buildWorkspaceGraph(modules[0], { showAliases });
      const alias = graph.nodes.find((node) => node.kind === "assign");
      const views = [graph];
      if (alias) views.push(queryNetlistView(graph, { mode: "focused", rootNodeIds: [alias.id], faninDepth: 0, fanoutDepth: 2 }).visibleGraph);
      for (const view of views) {
        const result = run(graph, view);
        assert.deepEqual(result.results, []);
        assert.equal(result.status, "partial");
        assert.ok(result.reasons.includes(issue));
      }
    }
  }
});

test("proved Liberty constants cannot fork through a pin or an alias", () => {
  const cellLibrary = buildLibertyModel(parseLiberty('library(demo) { cell(TIE) { pin(Y) { direction: output; function: "(!0)"; } } }'));
  assert.equal(cellLibrary.cells.TIE.logic.status, "constant");
  const { modules } = parseVerilog("module top(output z); wire x,t,p,q; TIE u(.Y(x)); assign t=x; BUF a(.A(t),.Y(p)); INV b(.A(t),.Y(q)); NAND2 m(.A(p),.B(q),.Y(z)); endmodule");
  for (const showAliases of [true, false]) {
    const graph = buildWorkspaceGraph(modules[0], { showAliases, cellLibrary });
    const result = run(graph);
    assert.equal(result.status, "complete"); assert.deepEqual(result.results, []);
  }
});

test("two names for a single signal at a gate never form independent paths", () => {
  const { modules } = parseVerilog("module top(input s,output z); wire t; assign t=s; NAND2 m(.A(s),.B(t),.Y(z)); endmodule");
  for (const showAliases of [true, false]) {
    const graph = buildWorkspaceGraph(modules[0], { showAliases });
    assert.deepEqual(run(graph).results, []);
  }
});

test("Netlist single-output DAG results match exhaustive physical-cell paths on induced subgraphs", () => {
  let seed = 11;
  const random = (bound) => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) >>> 8) % bound;
  for (let n = 0; n < 64; n++) {
    const names = ["a", "b"], lines = [];
    for (let i = 0; i < 7; i++) {
      const first = names[random(names.length)], second = names[random(names.length)];
      lines.push(`NAND2 g${i}(.A(${first}),.B(${second}),.Y(w${i}));`); names.push("w" + i);
    }
    const full = parse(`module top(input a,b,output z); wire ${names.slice(2).join(",")}; ${lines.join("\n")} assign z=w6; endmodule`);
    const visible = { ...full, nodes: full.nodes.filter(() => random(6) !== 0) };
    const ids = new Set(visible.nodes.map((node) => node.id));
    const outgoing = new Map(visible.nodes.map((node) => [node.id, new Set()]));
    for (const edge of full.edges) if (ids.has(edge.source) && ids.has(edge.target)) outgoing.get(edge.source).add(edge.target);
    const oracle = [];
    for (const stem of ids) for (const merge of ids) {
      if (stem === merge || !merge.startsWith("cell:")) continue;
      const paths = [];
      function visit(path) {
        if (path.at(-1) === merge) { paths.push(path); return; }
        for (const id of outgoing.get(path.at(-1))) visit([...path, id]);
      }
      visit([stem]);
      if (paths.some((p, i) => paths.slice(i + 1).some((q) => p[1] !== q[1] && p.slice(1, -1).every((id) => !q.includes(id))))) oracle.push(JSON.stringify([stem, merge]));
    }
    const actual = run(full, visible);
    const pairs = actual.results.map((result) => JSON.stringify([actual.scope.displayNodes.get(result.stemId).id, result.mergeId]));
    assert.deepEqual(pairs.sort(), oracle.sort());
  }
});

test("AIG blocks require both visible fanins of each internal AND", () => {
  const model = { nodes: ["a", "b"].map((id) => ({ id, kind: "pi", level: 0 })), edges: [] };
  for (const [id, inputs, negated, level] of [["p", ["a", "b"], [false, true], 1], ["q", ["a", "b"], [true, false], 1], ["r", ["p", "q"], [true, true], 2]]) {
    model.nodes.push({ id, kind: "and", level }); inputs.forEach((source, i) => model.edges.push({ id: id + i, source, target: id, inverted: negated[i], slot: i }));
  }
  assert.equal(analyzeAigStructure(model).blocks.results.length, 1);
  for (const missing of ["p0", "q1", "r1"]) {
    assert.equal(analyzeAigStructure({ ...model, edges: model.edges.filter((edge) => edge.id !== missing) }).blocks.results.length, 0);
  }
});
