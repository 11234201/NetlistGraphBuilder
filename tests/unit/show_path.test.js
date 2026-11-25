import { addPathSideInputs } from "../../src/domains/netlist/show_path.js";
import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { buildModuleWorkspace } from "../../src/app/moduleWorkspace.js";
import { getLayoutProvider } from "../../src/layout/layoutProvider.js";
import { DEFAULT_LAYOUT_PROVIDER_ID } from "../../src/layout/providerDefaults.js";
import { parseLiberty } from "../../src/parser/liberty_parser.js";
import { buildLibertyModel } from "../../src/infer/liberty_model.js";
import { createPathIndex, checkPathBudget } from "../../src/analysis/path_query.js";
import { levelText, normalizeShowPath, SHOW_PATH_POLICY } from "../../src/contracts/show_path.js";
import { netlistFeature } from "../../src/domains/netlist/netlist_feature.js";
import { aigFeature } from "../../src/domains/aig/aig_feature.js";
import { createNetlistReconvergenceScope } from "../../src/domains/netlist/reconvergence_scope.js";
import { createNetlistStructureIndex, analyzeNetlistReconvergence } from "../../src/domains/netlist/reconvergence_analysis.js";
import { analyzeAigStructure } from "../../src/domains/aig/structure_analysis.js";
import { createStandaloneSvg } from "../../src/render/svgExport.js";
import { createLayoutGolden, getLayoutGoldenState } from "../../src/domains/netlist/layout_golden.js";
import { encodeDomainWorkspace, decodeDomainWorkspace } from "../../src/persistence/domain_workspace_storage.js";

const query = (starts, ends) => ({ enabled: true, starts, ends });
const sorted = (values) => [...values].sort();
function index(ids, edges, outputs = []) {
  return createPathIndex(ids.map((id) => ({ id, displayId: id, label: id, cost: outputs.includes(id) ? 0 : 1,
    boundary: outputs.includes(id) ? "output" : null })), edges,
    new Map(ids.map((id) => [id, { key: id, label: id, starts: [id], ends: [id] }])));
}

test("path union and min/max equal an independent all-path oracle on every four-vertex DAG", () => {
  const ids = ["a", "b", "c", "d"];
  const possible = ids.flatMap((source, i) => ids.slice(i + 1).map((target) => ({ source, target, wire: source + target })));
  for (let mask = 0; mask < 64; mask++) {
    const edges = possible.filter((e, i) => mask & (1 << i));
    const graph = index(ids.toReversed(), edges.toReversed());
    for (const [starts, ends] of [[["b", "a"], ["d", "b"]], [["d"], ["a"]], [["a"], []], [[], ["c", "d"]]]) {
      const expected = new Map(), remaining = new Map(), wires = new Set(), actual = graph.query(query(starts, ends));
      function walk(path) {
        const id = path.at(-1), next = edges.filter((edge) => edge.source === id);
        if (ends.length ? ends.includes(id) : !next.length) path.forEach((node, i) => {
          const levels = expected.get(node) || [];
          levels.push(i); expected.set(node, levels);
          const toEnds = remaining.get(node) || [];
          toEnds.push(path.length - 1 - i); remaining.set(node, toEnds);
          if (i) wires.add(path[i - 1] + node);
        });
        for (const e of next) walk([...path, e.target]);
      }
      for (const id of starts.length ? starts : ids.filter((id) => !edges.some((e) => e.target === id))) walk([id]);
      assert.deepEqual(sorted(actual.nodeIds), sorted(expected.keys()));
      assert.deepEqual(sorted(actual.edgeIds), sorted(wires));
      for (const [id, distances] of expected) {
        const toEnds = remaining.get(id);
        assert.deepEqual(actual.levels.get(id).toTarget, { min: Math.min(...toEnds), max: Math.max(...toEnds) });
        assert.deepEqual([actual.levels.get(id).min, actual.levels.get(id).max], [Math.min(...distances), Math.max(...distances)]);
      }
    }
  }
});

test("cycle scope, endpoint limits, automatic boundaries and on-demand source detail", () => {
  const graph = index(["a", "b", "c", "x", "y"], ["ab", "bc", "xy", "yx"].map((wire) =>
    ({ source: wire[0], target: wire[1], wire })));
  const good = graph.query(query(["a", "b"], ["c"]));
  assert.equal(good.status, "complete");
  assert.deepEqual(good.fromStart("b").get("c"), { min: 1, max: 1 });
  const cycle = graph.query(query(["x"], []));
  assert.equal(cycle.status, "partial"); assert.equal(cycle.levels.get("x").max, null);
  assert.throws(() => graph.query(query(["stale"], [])), { code: "show-path.stale-endpoint" });
  assert.throws(() => normalizeShowPath(query([], [])), { code: "show-path.empty-query" });
  const ends = Array.from({ length: 40 }, (_, i) => "z" + i);
  assert.throws(() => normalizeShowPath(query([], ends)), { code: "show-path.endpoint-limit" });
  assert.throws(() => checkPathBudget(SHOW_PATH_POLICY.maximumObjects + 1), { code: "show-path.budget" });
  assert.equal(index(["a", ...ends], ends.map((target) => ({ source: "a", target, wire: target })))
    .query(query(["a"], [])).endCount, 40);
});

test("selected-end distances include only the requested target and survive Focused cuts", () => {
  const doc = aigFeature.importSource({ name: "branches.blif", text: [
    ".model branches", ".inputs a b", ".outputs direct deep", ".names a direct", "0 1",
    ".names a b x", "11 1", ".names x b deep", "11 1", ".end"
  ].join("\n") });
  const pi = doc.model.model.nodes.find((node) => node.kind === "pi" && node.label === "a");
  const po = doc.model.model.nodes.find((node) => node.kind === "po" && node.label === "deep");
  const showPath = query([pi.id], [po.id]);
  const focus = aigFeature.queryView(doc, { showPath, mode: "focused", rootNodeIds: [pi.id], faninDepth: 0, fanoutDepth: 0 });
  assert.deepEqual(focus.path.starts[0].toTarget, { min: 2, max: 2 });
  assert.ok(!focus.model.nodes.some((node) => node.kind === "po"));
  const gates = [...focus.path.levels.values()].filter((row) => row.min === 1);
  assert.ok(gates.length);
  for (const gate of gates) assert.deepEqual(gate.toTarget, { min: 1, max: 1 });
  assert.equal(levelText(focus.path.ends[0]), "To selected end 0 · From start 2");
});

test("structure demo measures only selected Ends, including endpoints outside Focused", () => {
  const name = "aig_structure_demo.blif";
  const text = readFileSync(new URL("../../examples/" + name, import.meta.url), "utf8");
  const doc = aigFeature.importSource({ name, text });
  const nodes = doc.model.model.nodes;
  const id = (label, kind) => nodes.find((node) => node.kind === kind && node.label === label).id;
  const y = id("y", "po"), x = id("x", "po"), a = id("a", "pi");
  const showPath = query([], [y]);
  const whole = aigFeature.queryView(doc, { showPath });
  const ranges = (path) => Object.fromEntries(path.starts.map((r) => [r.label, [r.toTarget.min, r.toTarget.max]]));
  assert.deepEqual(ranges(whole.path), { a: [4, 4], b: [4, 4], c: [4, 4], s: [2, 2] });
  for (const root of [y, a]) {
    const focus = aigFeature.queryView(doc, { showPath, mode: "focused", rootNodeIds: [root], faninDepth: 0, fanoutDepth: 0 });
    const hidden = root === a ? y : a;
    assert.ok(!focus.model.nodes.some((n) => n.id === hidden));
    assert.equal(focus.path, whole.path);
  }
  const both = aigFeature.queryView(doc, { showPath: query([], [x, y]) });
  assert.deepEqual(ranges(both.path), { a: [2, 4], b: [2, 4], c: [4, 4], s: [2, 2] });
  assert.deepEqual(ranges(aigFeature.queryView(doc, { showPath: query([a], []) }).path), { a: [2, 4] });
});

test("only cycles on a route to an output invalidate its distance", () => {
  const wires = ["ap", "ax", "xy", "yx", "bi", "ij", "ji", "jp", "pq", "zo"];
  const graph = index([...new Set(wires.join(""))], wires.map((wire) => ({ source: wire[0], target: wire[1], wire })), ["q", "o"]);
  const path = graph.query(query(["a", "b", "z"], []));
  assert.match(levelText(path.levels.get("a")), /To auto ends 1 ·/);
  assert.match(levelText(path.levels.get("x")), /To auto ends unreachable/);
  assert.match(levelText(path.levels.get("b")), /To auto ends unknown/);
  assert.match(levelText(path.levels.get("p")), /To auto ends 0 ·/);
  const fromB = path.fromStart("b");
  assert.equal(fromB.get("q"), null);
  assert.equal(fromB.has("o"), false);
  assert.deepEqual(path.fromStart("a").get("q"), { min: 1, max: 1 });
});

test("Netlist projection preserves pin boundaries, BUF/INV costs, and path-external side inputs", () => {
  const doc = netlistFeature.importSource({ text: `module top(input a,input b,input ck,output z,output q);
    wire p; BUF U(.A(a),.Y(p)); NAND2 G(.A(p),.B(b),.Y(z)); DFF F(.D(z),.CK(ck),.Q(q)); endmodule` });
  const run = (starts, ends, opts = {}) => netlistFeature.queryView(doc, {
    unitId: "top", showPath: query(starts, ends), ...opts }, { transforms: { useFanoutHubs: false } });
  const result = run(["input:a"], ["output:z"]);
  const row = result.path.ends[0];
  assert.deepEqual([row.toTarget, row.min, row.max], [{ min: 0, max: 0 }, 2, 2]);
  assert.deepEqual(result.path.starts[0].toTarget, { min: 2, max: 2 });
  assert.ok(result.visibleGraph.nodes.some((n) => n.kind === "focus-input" && n.label === "b"));
  assert.ok(!result.path.nodeIds.has("input:b"));
  const local = run(["cell:U"], ["cell:G"], { mode: "focused", rootNodeIds: ["cell:G"], faninDepth: 0, fanoutDepth: 0 });
  assert.equal(local.path.ends[0].max, 1); assert.equal(local.path.ends[0].label, "G.Y");
  assert.ok(!local.visibleGraph.nodes.some((n) => n.id === "cell:U"));
  assert.equal(run(["input:a"], ["output:q"]).path.status, "no-path");
  assert.equal(run(["cell:F"], ["output:q"]).path.ends[0].max, 0);
  assert.match(levelText(run(["input:ck"], []).path.starts[0]), /To auto end 0/);
  assert.equal(run(["input:a"], [JSON.stringify(["pin", "cell:F", "D"])]).path.ends[0].max, 2);
  assert.equal(run(["input:ck"], [JSON.stringify(["pin", "cell:F", "D"])]).path.status, "no-path");
  assert.equal(run(["input:a"], ["output:z"], { mode: "focused", rootNodeIds: ["cell:F"] }).visibleGraph.nodes.length, 0);
  const empty = run(["input:a"], ["output:q"]).visibleGraph;
  const golden = createLayoutGolden(empty, { layoutOptions: { display: { showPath: query(["input:a"], ["output:q"]) } } });
  assert.equal(golden.version, 4); assert.deepEqual(getLayoutGoldenState(golden).display.showPath, golden.layoutOptions.display.showPath);
});

test("Liberty output functions, sequential pins, ambiguous nets and hierarchical boundaries", () => {
  const library = buildLibertyModel(parseLiberty('library(x){cell(SPLIT){pin(A){direction:input;}pin(B){direction:input;}pin(Z){direction:output;function:"A";}pin(W){direction:output;function:"B";}}}'));
  const doc = netlistFeature.importSource({ text: `module top(input a,input b,input ck,output z, output w, output h, output q);
    wire t; BUF first(.A(a),.Y(t)); SPLIT U(.A(t),.B(b),.Z(z),.W(w));
    child H(.a(a),.y(h)); DFF F(.D(z),.CK(ck),.Q(q)); endmodule
    module child(input a,output y); BUF G(.A(a),.Y(y)); endmodule` });
  const run = (starts, ends) => netlistFeature.queryView(doc, { unitId: "top", showPath: query(starts, ends) }, { cellLibrary: library }).path;
  assert.equal(run(["input:a"], ["output:w"]).status, "no-path");
  assert.deepEqual(run(["input:a", "input:b"], ["cell:U"]).ends.map((r) => [r.label, r.max]), [["U.W", 1], ["U.Z", 2]]);
  assert.equal(run(["cell:U"], ["output:w"]).starts.filter((r) => r.reachable).length, 1);
  assert.equal(run(["input:a"], ["output:h"]).status, "no-path");
  assert.equal(run(["cell:F"], ["cell:F"]).ends.find((r) => r.label === "F.Q").max, 0);
  const ambiguous = netlistFeature.importSource({ text: "module m(input a,input b,output z,output ok); BUF X(.A(a),.Y(z)); BUF Y(.A(b),.Y(z)); BUF V(.A(a),.Y(ok)); endmodule" });
  const good = netlistFeature.queryView(ambiguous, { unitId: "m", showPath: query(["input:a"], ["output:ok"]) }).path;
  assert.equal(good.status, "complete");
  assert.equal(good.unknownDistanceCount, 0);
  assert.match(levelText(good.starts[0]), /To selected end 1/);
  assert.deepEqual(good.ends[0].toTarget, { min: 0, max: 0 });
  const partial = netlistFeature.queryView(ambiguous, { unitId: "m", showPath: query(["input:a"], ["output:z"]) }).path;
  assert.equal(partial.status, "partial"); assert.ok(partial.reasons.includes("multiple-drivers"));
});

test("Show Path qualifies missing or unsupported output functions and isolates sibling output cones", () => {
  const library = buildLibertyModel(parseLiberty('library(x){cell(SPLIT){pin(A){direction:input;}pin(B){direction:input;}pin(Z){direction:output;function:"A";}pin(W){direction:output;function:"B";}pin(U){direction:output;}pin(V){direction:output;function:"MISSING";}}}'));
  const doc = netlistFeature.importSource({ text: "module top(input a,input b,input other,output z,output w,output u,output v); SPLIT G(.A(a),.B(b),.Z(z),.W(w),.U(u),.V(v)); endmodule" });
  const view = (start, end) => netlistFeature.queryView(doc, { unitId: "top", showPath: query(["input:" + start], ["output:" + end]) }, { cellLibrary: library });
  const known = view("a", "z");
  assert.equal(known.path.status, "complete");
  assert.deepEqual(known.visibleGraph.nodes.filter((n) => n.kind === "focus-input").map((n) => n.label), []);
  assert.equal(view("b", "z").path.status, "no-path");
  for (const end of ["u", "v"]) {
    const uncertain = view("a", end).path;
    assert.equal(uncertain.status, "partial");
    assert.ok(uncertain.reasons.includes("unknown-output-function"));
    assert.equal(uncertain.edgeIds.size, 0);
    assert.equal(view("other", end).path.status, "no-path");
  }
});

test("permuting Verilog statements and endpoint selections preserves path levels and routed geometry", async () => {
  const cells = ["BUF L(.A(a),.Y(p));", "INV R(.A(b),.Y(q));", "NAND2 M(.A(p),.B(q),.Y(z));"];
  async function snapshot(statements, starts) {
    const doc = netlistFeature.importSource({ text: "module m(input a,input b,output z); wire p,q;" + statements.join("\n") + "endmodule" });
    const { graph } = await buildModuleWorkspace({ module: doc.model.modules[0], showPath: query(starts, ["output:z"]),
      layoutProvider: getLayoutProvider(DEFAULT_LAYOUT_PROVIDER_ID) });
    const coordinates = graph.nodes.map((n) => [n.id, n.x, n.y, n.width, n.height]).sort();
    const wires = graph.edges.map((e) => [e.source, e.sourcePin, e.target, e.targetPin, e.points]).sort();
    return { coordinates, wires, levels: [...graph.path.levels], status: graph.layoutStatus };
  }
  assert.deepEqual(await snapshot(cells, ["input:a", "cell:R"]), await snapshot(cells.toReversed(), ["cell:R", "input:a"]));
});

test("reconvergence witnesses use only real wires in the combined Path and Focused view", () => {
  const doc = netlistFeature.importSource({ text: "module m(input s,output z); wire a,b; BUF L(.A(s),.Y(a)); INV R(.A(s),.Y(b)); NAND2 M(.A(a),.B(b),.Y(z)); endmodule" });
  const inspect = (showPath, options = {}) => {
    const view = netlistFeature.queryView(doc, { unitId: "m", showPath, ...options });
    const scope = createNetlistReconvergenceScope(view.fullGraph, view.visibleGraph);
    return analyzeNetlistReconvergence(createNetlistStructureIndex(scope.model)).reconvergence.results;
  };
  const all = query(["input:s"], ["output:z"]);
  assert.equal(inspect(all).length, 1);
  assert.equal(inspect(query(["cell:L"], ["output:z"])).length, 0);
  assert.equal(inspect(all, { mode: "focused", rootNodeIds: ["cell:L"], faninDepth: 1, fanoutDepth: 1 }).length, 0);
});

test("indexed AIG keeps source endpoints available and never requests a Graphviz diagram until a subset is selected", async () => {
  const doc = aigFeature.importSource({ name: "mapped.blif", text: "# n0 top/in\n.model m\n.inputs n0 b\n.outputs y\n.names n0 b y\n11 1\n.end" });
  const session = aigFeature.restoreFocus(doc, "whole", { viewMode: "search-first" });
  const stages = aigFeature.createWorkspaceStages({ layout: { render() { assert.fail("unexpected Graphviz call"); } } });
  const request = { document: doc, session };
  const view = stages.query(request), diagram = stages.project(view, request);
  assert.equal(view.searchFirst, true);
  assert.equal(diagram.dot, null);
  assert.equal((await stages.layout(diagram, request)).nodes.length, 0);
  const source = doc.model.model;
  assert.ok(aigFeature.search(aigFeature.buildSearchIndex(doc), "top/in").length);
  const pi = source.nodes.find((n) => n.label === "n0"), po = source.nodes.find((n) => n.kind === "po");
  const filtered = aigFeature.queryView(doc, { ...session, showPath: query([pi.id], [po.id]) });
  assert.equal(filtered.path.status, "complete");
  assert.ok(filtered.model.nodes.some((n) => n.id === po.id));
  assert.equal(aigFeature.restoreFocus(doc, "whole", { deferWholeLayout: true, focusedRootNodeIds: ["obsolete"] }).viewMode, "search-first");
});

test("AIG mapped endpoints, cut polarity, output and start distances, archive identity and SVG", () => {
  const source = { name: "demo.blif", text: "# a a<sig>\n.model m\n.inputs a b c\n.outputs z\n.names a b n\n01 1\n10 1\n.names n c z\n11 1\n.end" };
  const doc = aigFeature.importSource(source);
  const model = doc.model.model, index = aigFeature.pathIndex(model);
  const mapped = [...index.endpoints.values()].find((e) => e.label.includes("a<sig>") && e.key.startsWith("["));
  const end = model.nodes.find((n) => n.kind === "po").id;
  const showPath = query([mapped.key], [end]);
  const whole = aigFeature.queryView(doc, { showPath });
  assert.equal(whole.path.ends[0].max, 3); assert.deepEqual(whole.path.starts[0].toTarget, { min: 3, max: 3 });
  assert.deepEqual(whole.path.ends[0].toTarget, { min: 0, max: 0 });
  const focus = aigFeature.queryView(doc, { showPath, mode: "focused", rootNodeIds: [end], faninDepth: 0, fanoutDepth: 0 });
  assert.ok(analyzeAigStructure(whole.analysisModel).reconvergence.results.length > 0);
  assert.equal(analyzeAigStructure(focus.analysisModel).reconvergence.results.length, 0);
  assert.equal(focus.path, whole.path); assert.equal(focus.analysisModel.nodes.length, 1);
  assert.ok(whole.model.nodes.some((n) => n.kind === "boundary"));
  assert.ok(whole.model.edges.some((e) => e.inverted));
  const xml = createStandaloneSvg('<svg viewBox="0 0 640 420"></svg>', whole.path, "m");
  assert.match(xml, /a&lt;sig&gt;/); assert.match(xml, /To selected end 3 · From start 0/);
  const archive = JSON.parse(encodeDomainWorkspace({ domainId: "aig", source, focus: { showPath } }));
  assert.deepEqual(decodeDomainWorkspace(JSON.stringify(archive)).focus.showPath, showPath);
  archive.source.text += "\n# revised";
  assert.ok(decodeDomainWorkspace(JSON.stringify(archive)).pathSourceMismatch);
});

test("side input projections use escaped display names while retaining the canonical net", () => {
  const edge = { id: "e", net: "a/b", label: "\\\\a/b", target: "c", targetPin: "A" };
  const path = { sideInputPins: new Set([JSON.stringify(["pin", "c", "A"])]), edgeIds: new Set() };
  const display = addPathSideInputs({ edges: [edge] }, { nodes: [{ id: "c" }], edges: [] }, path);
  assert.equal(display.nodes[1].label, edge.label);
  assert.deepEqual(display.nodes[1].ref, { name: edge.net, displayName: edge.label });
});
