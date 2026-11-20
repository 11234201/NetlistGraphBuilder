import assert from "node:assert/strict";
import test from "node:test";
import { createTimingMatchReporter } from "../../src/app/timing_match_log.js";
import { createInputController } from "../../src/app/input_controller.js";
import { createWorkspaceRenderController } from "../../src/app/workspace_render_controller.js";
import { createRenderGeneration } from "../../src/render/renderGeneration.js";
import { createProcessLog } from "../../src/app/processLog.js";
import { buildWorkspaceGraph } from "../../src/domains/netlist/netlist_graph_projection.js";
import { importTimingSource, mergeImportedTiming } from "../../src/domains/netlist/timing_import.js";
import { parseVerilog } from "../../src/parser/verilogParser.js";

const top = "LocalDesign_1of1";
const modules = parseVerilog(`
module Kernel(input a, output z);
  wire n;
  BUF u1 (.A(a), .Z(n));
  BUF u2 (.A(n), .Z(z));
endmodule
module LocalDesign_1of1(input a, output z);
  Kernel k (.a(a), .z(z));
endmodule`).modules;
const kernel = modules[0];
const project = (timing, module = kernel, options = {}) =>
  buildWorkspaceGraph(module, { timing, moduleLibrary: modules, ...options });
const table = (scope, rows, name = "run.txt") =>
  importTimingSource(`@module ${scope}\npoint at rt slack\n` + rows.map((p) => p + " 2 1 -1").join("\n"), { name }).timing;

test("one-round root identity and prefixes distinguish scoped-out records from missing entities", () => {
  const rows = ["k/u1/Z", "k/u2/Z"];
  const valid = project(table(top, rows));
  assert.equal(valid.timingSummary.diagnostics.annotatedCellCount, 2);
  assert.equal(valid.nodes.find((n) => n.id === "cell:u1").timing.pins.Z.slack, -1);
  const filtered = project(table("LocalDesign", rows));
  const diag = filtered.timingSummary.diagnostics;
  assert.deepEqual(diag.reportScopes, ["LocalDesign"]);
  assert.equal(filtered.timingSummary.scopedRecordCount, 0);
  assert.equal(diag.excludedReasons["root-path-mismatch"], 2);
  assert.equal(diag.excludedExamples[0].expectedPrefix, top + "/k");
  assert.equal(diag.excludedExamples[0].line, 3);
  assert.deepEqual(diag.cellsWithoutTiming, ["u1", "u2"]);

  const mixed = project(table(top, ["k/u1/Z", "k/unknown/Z", "LocalDesign/k/u2/Z"]));
  assert.equal(mixed.timingSummary.scopedRecordCount, 2);
  assert.equal(mixed.timingSummary.matchedRecordCount, 1);
  assert.deepEqual(mixed.timingSummary.diagnostics.unmatchedExamples, [{
    point: "k/unknown/Z", scope: top, kind: null, fileName: "run.txt", line: 4, candidates: ["unknown/Z", "k/unknown/Z"]
  }]);
  assert.equal(mixed.timingSummary.diagnostics.excludedReasons["occurrence-path-mismatch"], 1);
  assert.deepEqual(mixed.timingSummary.diagnostics.cellsWithoutTiming, ["u2"]);
  const corrected = project(table(top, ["k/u1/Z", top + "/k/u2/Z"]));
  assert.equal(corrected.timingSummary.diagnostics.annotatedCellCount, 2);
});

test("an exact module scope can shadow a valid ancestor record for the same module", () => {
  const fromTop = table(top, ["k/u1/Z"], "top.txt");
  const local = table("Kernel", ["u2/Z"], "kernel.txt");
  const graph = project(mergeImportedTiming(fromTop, local));
  assert.equal(graph.nodes.find((n) => n.id === "cell:u2").timing.worstSlack, -1);
  assert.equal(graph.nodes.find((n) => n.id === "cell:u1").timing, undefined);
  const diag = graph.timingSummary.diagnostics;
  assert.equal(diag.excludedReasons["other-named-scope"], 1);
  assert.equal(diag.excludedExamples[0].fileName, "top.txt");
  assert.equal(diag.excludedExamples[0].point, "k/u1/Z");
});

test("different candidate paths for one cell are counted separately from final coverage", () => {
  const graph = project(table("Kernel", ["left/u1/Z", "right/u1/Z", "u2/Z"]));
  const { matchedRecordCount, diagnostics } = graph.timingSummary;
  assert.equal(matchedRecordCount, 3);
  assert.equal(diagnostics.annotatedCellCount, 1);
  assert.equal(diagnostics.ambiguousGroupCount, 1);
  assert.deepEqual(diagnostics.ambiguousExamples, [{ instance: "u1", paths: ["left/u1", "right/u1"] }]);
});

test("matched occurrences are named in the log evidence until navigation disambiguates", () => {
  const library = parseVerilog(`
    module Leaf(input a, output z); BUF u (.A(a), .Z(z)); endmodule
    module LocalDesign_1of1(input a, output y, output z);
      Leaf k0 (.a(a), .z(y)); Leaf k1 (.a(a), .z(z)); endmodule`).modules;
  const timing = table(top, ["k0/u/Z", "k1/u/Z"]);
  const build = (path) => buildWorkspaceGraph(library[0], { moduleLibrary: library, timing,
    occurrenceRootModuleName: top, occurrencePath: path });
  assert.deepEqual(build([]).timingSummary.occurrenceExamples, [top + "::k0", top + "::k1"]);
  const specific = build(["k1"]).timingSummary;
  assert.equal(specific.diagnostics.occurrencePath, "k1");
  assert.equal(specific.diagnostics.annotatedCellCount, 1);
});

test("parse warnings preserve field and position without exporting raw invalid values", () => {
  const imported = importTimingSource("@module Kernel\npoint at rt slack\nu1/Z 2 1 -1\nu2/Z private-value 1 -1");
  assert.equal(imported.summary.recordCount, 1);
  assert.equal(imported.summary.diagnosticCount, 1);
  const [example] = imported.summary.diagnosticExamples;
  assert.equal(example.code, "invalid-number");
  assert.equal(example.field, "at");
  assert.equal(example.line, 4);
  assert.ok(!JSON.stringify(imported.summary).includes("private-value"));
  assert.throws(() => importTimingSource('{"points":{"u1/Z":{"rt":"private-value"}}}'),
    (error) => error.diagnostic.diagnosticExamples[0].point === "u1/Z" && !JSON.stringify(error).includes("private-value"));
});

test("bounded hierarchy search reports a cutoff on a valid but unreachable deep point", () => {
  const wrappers = Array.from({ length: 17 }, (_, i) =>
    `module m${i}(input a, output z); m${i + 1} k (.a(a), .z(z)); endmodule`);
  const deep = parseVerilog([...wrappers, "module m17(input a, output z); BUF u (.A(a), .Z(z)); endmodule"].join("\n")).modules;
  const graph = buildWorkspaceGraph(deep.at(-1), { moduleLibrary: deep, timing: table("m0", ["k/".repeat(17) + "u/Z"]) });
  assert.equal(graph.timingSummary.scopedRecordCount, 0);
  assert.equal(graph.timingSummary.diagnostics.hierarchyDepthLimitReached, 16);
});

test("timing import preserves its original failure and previous dataset when logging fails", () => {
  const previous = table(top, ["k/u1/Z"]);
  const state = { timing: previous };
  const controller = createInputController({ state, elements: {}, services: {
    logProcess() { throw Error("broken log sink"); }
  } });
  assert.throws(() => controller.loadTimingText("@module bad\npoint at rt slack\nu/Z broken 1 0", "bad.txt"),
    (error) => error.diagnostic.diagnosticExamples[0].code === "invalid-number");
  assert.equal(state.timing, previous);
});

test("aborted and superseded Single mounts never publish their timing outcome", async () => {
  for (const supersede of [false, true]) {
    const timing = table("Kernel", ["missing/Z"]);
    const graph = project(timing);
    const generation = createRenderGeneration();
    const events = [];
    const services = new Proxy({ renderGeneration: generation, logProcess: (...args) => events.push(args) },
      { get: (target, key) => target[key] || (() => {}) });
    const controller = createWorkspaceRenderController({ state: { fullGraph: graph, timing, compare: { active: false } },
      elements: { mount: {} }, services });
    const abort = new AbortController();
    controller.commitCurrentGraph(graph, graph, { alreadyMounted: true, signal: abort.signal });
    if (supersede) generation.begin();
    else abort.abort();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(events, []);
  }
});

test("Process Log samples stay bounded and repeat renders deduplicate independently per side and import", () => {
  const longName = "Missing_" + "p".repeat(1000);
  const rows = Array.from({ length: 20 }, (_, i) => longName + i + "/Z");
  const timing = table("Kernel", rows);
  const graph = project(timing);
  const log = createProcessLog();
  const sink = (level, phase, message, details) => log.append({ level, phase, message, details });
  const report = createTimingMatchReporter();
  const context = { document: { documentId: "d", sourceRevision: 3 }, requestId: 1, side: "left" };
  report(sink, graph, timing, context);
  report(sink, structuredClone(graph), timing, { ...context, requestId: 2 });
  report(sink, graph, timing, { ...context, side: "right" });
  report(sink, graph, table("Kernel", rows), { ...context, requestId: 3 });
  const entries = log.toJsonLines().split("\n").map(JSON.parse);
  assert.deepEqual(entries.map((e) => e.details.requestId), [1, 1, 3]);
  assert.deepEqual(entries.map((e) => e.details.sessionId), ["compare:left", "compare:right", "compare:left"]);
  const details = entries[0].details;
  assert.equal(details.code, "timing.partial-match");
  assert.equal(details.unmatchedRecordCount, 20);
  assert.equal(details.unmatchedExamples.length, 4);
  assert.ok(details.unmatchedExamples[0].point.length <= 240);
  assert.equal(details.documentRevision, 3);
  assert.doesNotThrow(() => report(() => { throw Error("sink unavailable"); }, graph, timing, { ...context, side: null }));
});
