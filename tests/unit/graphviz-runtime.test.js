import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createGraphvizRuntime, GRAPHVIZ_RUNTIME_VERSION } from "../../src/platform/graphviz_runtime.js";
import { graphvizJsonToGeometry } from "../../src/layout/graphviz_geometry.js";
import { aigFeature } from "../../src/domains/aig/aig_feature.js";
import { buildModuleGraph, findBoundaryViolations } from "../../tools/module_graph.mjs";

const vendorUrl = new URL("../../vendor/graphviz/", import.meta.url);

test("pinned Graphviz distribution and notices match the offline manifest", () => {
  const manifest = JSON.parse(readFileSync(new URL("manifest.json", vendorUrl), "utf8"));
  assert.equal(manifest.version, "3.31.0");
  for (const item of manifest.files) {
    const content = readFileSync(new URL(item.path, vendorUrl));
    assert.equal(content.length, item.bytes, item.path);
    assert.equal(createHash("sha256").update(content).digest("hex"), item.sha256, item.path);
  }
  const distribution = readFileSync(new URL("viz.js", vendorUrl), "utf8");
  const { graph, diagnostics } = buildModuleGraph(new Map([["vendor/viz.js", distribution]]));
  assert.deepEqual(diagnostics, [], "Distribution cannot gain runtime module dependencies");
  assert.deepEqual(graph.get("vendor/viz.js"), []);
});

test("architecture permits only the named Graphviz adapter static vendor import", () => {
  const source = 'import { instance } from "../../vendor/graphviz/viz.js";';
  const allowed = buildModuleGraph(new Map([["platform/graphviz_vendor.js", source]]));
  assert.deepEqual(allowed.diagnostics, []);
  assert.deepEqual(findBoundaryViolations(allowed.graph), []);
  for (const [name, code] of [
    ["platform/other.js", source],
    ["layout/graphviz_vendor.js", source],
    ["platform/graphviz_vendor.js", 'import "../../vendor/graphviz/other.js";'],
    ["platform/graphviz_vendor.js", 'import("../../vendor/graphviz/viz.js");']
  ]) assert.ok(buildModuleGraph(new Map([[name, code]])).diagnostics.length, name);
  const mixed = buildModuleGraph(new Map([["platform/graphviz_vendor.js", source], ["platform/other.js", source]]));
  assert.equal(findBoundaryViolations(mixed.graph).length, 1, "Creating the approved vendor leaf must not authorize a second importer");
});

function fakeWorkers() {
  const workers = [];
  return { workers, workerFactory: () => {
    const worker = { requests: [], terminated: false,
      postMessage(value) { this.requests.push(value); },
      terminate() { this.terminated = true; },
      reply(result, request = this.requests[0]) { this.onmessage({ data: { id: request.id, result } }); }
    };
    workers.push(worker);
    return worker;
  } };
}

test("Graphviz worker is lazy, reused, cancelled physically and rejects stale results", async () => {
  const fixture = fakeWorkers();
  const runtime = createGraphvizRuntime(fixture);
  assert.equal(runtime.version, GRAPHVIZ_RUNTIME_VERSION);
  assert.equal(fixture.workers.length, 0);
  const first = runtime.render("digraph{}");
  fixture.workers[0].reply({ first: true });
  assert.deepEqual(await first, { first: true });
  const signal = new AbortController();
  const cancelled = runtime.render("digraph{}", { signal: signal.signal });
  const rejection = assert.rejects(cancelled, { name: "AbortError" });
  signal.abort();
  await rejection;
  assert.equal(fixture.workers[0].terminated, true);
  const second = runtime.render("digraph{}", { format: "dot_json" });
  fixture.workers[0].reply({ stale: true });
  fixture.workers[1].reply({ second: true });
  assert.deepEqual(await second, { second: true });
  assert.equal(fixture.workers[1].requests[0].format, "dot_json");
  runtime.dispose();
  assert.equal(fixture.workers[1].terminated, true);
  await assert.rejects(runtime.render("digraph{}"), /disposed/);
});

test("timeout and worker failure terminate WASM and permit a fresh worker", async () => {
  const fixture = fakeWorkers();
  const runtime = createGraphvizRuntime({ ...fixture, timeoutMs: 5 });
  await assert.rejects(runtime.render("digraph{}"), { name: "TimeoutError" });
  assert.equal(fixture.workers[0].terminated, true);
  const next = runtime.render("digraph{}");
  fixture.workers[1].onerror({ message: "load failure" });
  await assert.rejects(next, /load failure/);
  assert.equal(fixture.workers[1].terminated, true);
  const fresh = runtime.render("digraph{}");
  fixture.workers[2].reply({ ok: true });
  assert.deepEqual(await fresh, { ok: true });
  runtime.dispose();
});

test("Graphviz worker failures preserve origin stack, diagnostic and cause", async () => {
  const fixture = fakeWorkers();
  const runtime = createGraphvizRuntime(fixture);
  const pending = runtime.render("digraph{}");
  const worker = fixture.workers[0];
  worker.onmessage({ data: { id: worker.requests[0].id, error: { name: "LayoutError", message: "Invalid graph",
    stack: "LayoutError at graphviz_worker.js:71", cause: { message: "provider failed" }, diagnostic: { line: 8 } } } });
  await assert.rejects(pending, (error) => {
    assert.equal(error.name, "LayoutError");
    assert.match(error.stack, /graphviz_worker.js:71/);
    assert.deepEqual(error.cause, { message: "provider failed" });
    assert.equal(error.diagnostic.line, 8);
    return true;
  });
  const failed = runtime.render("digraph{}");
  const original = new Error("worker crash", { cause: new Error("worker initialization") });
  worker.onerror({ error: original });
  await assert.rejects(failed, (error) => error === original);
  runtime.dispose();
});

test("real embedded WASM preserves parallel curves, labels, orientation and dot_json", async () => {
  const { instance } = await import("../../src/platform/graphviz_vendor.js");
  const viz = await instance();
  assert.equal(viz.graphvizVersion, "16.1.0");
  assert.ok(viz.formats.includes("dot_json"));
  const dot = 'digraph {rankdir=BT; a[shape=triangle,label="输入 <&>"]; b[shape=ellipse]; c[shape=invtriangle,label="output"]; a->b[id="e0"]; a->b[id="e1",style=dashed]; b->c[id="e2"];}';
  const json = viz.renderJSON(dot);
  const geometry = graphvizJsonToGeometry(json);
  assert.equal(geometry.kind, "curve-geometry.v1");
  assert.equal(geometry.nodes.length, 3);
  assert.equal(geometry.edges.length, 3);
  assert.equal(geometry.nodes[0].labels[0].text, "输入 <&>");
  assert.equal(geometry.nodes[0].shapes[0].type, "polygon");
  assert.equal(geometry.nodes[1].shapes[0].type, "ellipse");
  assert.ok(geometry.nodes[0].center.y > geometry.nodes[2].center.y);
  assert.notEqual(geometry.edges[0].paths[0], geometry.edges[1].paths[0]);
  assert.match(geometry.edges[0].paths[0], / C/);
  assert.equal(geometry.edges[0].arrows[0].type, "polygon");
  assert.equal("points" in geometry.edges[0], false, "Curves must not masquerade as orthogonal points");
  assert.deepEqual(graphvizJsonToGeometry(viz.renderJSON(dot)), geometry);
  const parsed = JSON.parse(viz.renderString(dot, { format: "dot_json" }));
  assert.equal(parsed.edges.length, 3);
  assert.equal(parsed.objects[0].label, "输入 <&>");
});

test("curve geometry rejects invalid values and drops untrusted drawing attributes", async () => {
  const { instance } = await import("../../src/platform/graphviz_vendor.js");
  const viz = await instance();
  const json = viz.renderJSON('digraph { a[URL="javascript:alert(1)",tooltip="bad",color="red"]; }');
  const geometry = graphvizJsonToGeometry(json);
  assert.doesNotMatch(JSON.stringify(geometry), /javascript|tooltip|red/);
  assert.throws(() => graphvizJsonToGeometry({ ...json, bb: "0,0,NaN,10" }), /bounds/);
  json.objects[0].pos = "Infinity,0";
  assert.throws(() => graphvizJsonToGeometry(json), /coordinates/);
});

test("real embedded WASM preserves literal escaped names from BLIF in curve labels", async () => {
  const { instance } = await import("../../src/platform/graphviz_vendor.js");
  const viz = await instance();
  const source = readFileSync(new URL("../fixtures/aig/escaped_labels.blif", import.meta.url), "utf8");
  const document = aigFeature.importSource({ text: source, format: "blif" }, { documentId: "escaped-blif" });
  const { model } = document.model;
  const stages = aigFeature.createWorkspaceStages({ layout: { version: "real-viz-escaped-labels", render: async (dot) => viz.renderJSON(dot) } });
  const diagram = stages.project(document.model);
  const geometry = await stages.layout(diagram, { document });
  assert.equal(model.nodes.length, 24);
  const labelsById = new Map(geometry.nodes.map((node) => [node.id, node.labels.map((label) => label.text)]));
  for (const node of model.nodes) assert.deepEqual(labelsById.get(node.id), [node.label], node.label);
  assert.deepEqual(graphvizJsonToGeometry(viz.renderJSON(diagram.dot), { nodeLabels: diagram.nodeLabels }), geometry,
    "Escaped labels must remain deterministic");
});

test("original plain labels preserve DOT line breaks, empty lines and literal escape sequences", async () => {
  const { instance } = await import("../../src/platform/graphviz_vendor.js");
  const viz = await instance();
  const document = aigFeature.importSource({ text: String.raw`digraph {
    a[shape=triangle,label="first\n\nsecond"];
    b[shape=triangle,label="literal\\n"];
    c[shape=triangle,label="pair\\\\N"];
    d[shape=triangle,label=""];
    output[shape=invtriangle,label="\nresult\n"];
    output->a[dir=back];
  }`, format: "abc-dot" }, { documentId: "escaped-dot" });
  const diagram = aigFeature.projectDiagram(document.model);
  const json = viz.renderJSON(diagram.dot);
  const geometry = graphvizJsonToGeometry(json, { nodeLabels: diagram.nodeLabels });
  const bySource = (id) => geometry.nodes.find((positioned) => document.model.model.nodes
    .find((node) => node.id === positioned.id).sourceRefs.some((ref) => ref.id === id));
  assert.deepEqual(bySource("a").labels.map((label) => label.text), ["first", "second"]);
  assert.deepEqual(bySource("b").labels.map((label) => label.text), [String.raw`literal\n`]);
  assert.deepEqual(bySource("c").labels.map((label) => label.text), [String.raw`pair\\N`]);
  assert.deepEqual(bySource("d").labels, []);
  assert.deepEqual(bySource("output").labels.map((label) => label.text), ["result"]);
  const original = json.objects.find((node) => node.id === bySource("a").id)._ldraw_.filter((command) => command.op === "T");
  assert.ok(Math.abs((bySource("a").labels[1].y - bySource("a").labels[0].y) -
    (original[0].pt[1] - original[1].pt[1])) < 1e-9, "Empty-line spacing must remain the engine's geometry");
  assert.throws(() => graphvizJsonToGeometry(json, { nodeLabels: new Map([[bySource("a").id, "missing line"]]) }), /drawing lines/);
});
