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
import { missingCellTimingDetails } from "../../src/timing/timing_diagnostics.js";
import { mergeTimingDatasets } from "../../src/timing/timingParser.js";
import { renderTimingPanel } from "../../src/ui/timingPanel.js";

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
  assert.equal(graph.timingSummary.candidateMatchedRecordCount, 3);
  assert.equal(matchedRecordCount, 1);
  assert.equal(graph.timingSummary.unmatchedRecordCount, 2);
  const node = graph.nodes.find((n) => n.id === "cell:u1");
  const evidence = missingCellTimingDetails(node, graph.timingSummary).evidence["ambiguous-cell-path"];
  assert.deepEqual(evidence.paths, ["left/u1", "right/u1"]);
  assert.equal(evidence.count, 2);
  assert.equal(diagnostics.annotatedCellCount, 1);
  assert.equal(diagnostics.ambiguousGroupCount, 1);
  assert.deepEqual(diagnostics.ambiguousExamples, [{ instance: "u1", paths: ["left/u1", "right/u1"] }]);
});

test("an exact pin target wins over alternate groups and preferred samples still represent the same target", () => {
  const timing = table("Kernel", ["left/u1/Z", "left/u1/A", "u1/Z", "u1/Z", "u2/Z"]);
  const { timingSummary: summary } = project(timing);
  assert.equal(summary.candidateMatchedRecordCount, 5);
  assert.equal(summary.matchedRecordCount, 3);
  assert.equal(summary.unmatchedRecordCount, 2);
  assert.deepEqual(summary.diagnostics.unresolvedPins.reasons, { "shadowed-by-exact-path": 2 });
  assert.equal(summary.diagnostics.unresolvedPins.examples[0].point, "left/u1/Z");
  assert.equal(summary.diagnostics.annotatedCellCount, 2);
});

test("a missing cell outside the log samples retains grouped evidence from each input stage", () => {
  const names = Array.from({ length: 10 }, (_, i) => "u" + i);
  const mod = parseVerilog("module Kernel(input a, output z);" +
    names.map((n) => `BUF ${n} (.A(a), .Z(z));`).join("\n") + "endmodule").modules[0];
  const outside = table(top, names.map((n) => "k/" + n + "/Z"), "<top>.txt");
  const local = importTimingSource("@module Kernel\npoint at rt slack\nu0/Z 1 2 1\nu9/Z invalid 2 1",
    { name: "kernel.txt" }).timing;
  const graph = project(mergeImportedTiming(outside, local), mod);
  assert.ok(!graph.timingSummary.diagnostics.cellsWithoutTiming.includes("u9"));
  const node = graph.nodes.find((n) => n.id === "cell:u9");
  const details = missingCellTimingDetails(node, graph.timingSummary);
  assert.equal(details.evidence["other-named-scope"].point, "k/u9/Z");
  assert.equal(details.evidence["other-named-scope"].line, 12);
  assert.equal(details.evidence["parse-invalid-number"].fileName, "kernel.txt");
  assert.equal(details.evidence["parse-invalid-number"].scope, "Kernel");
  assert.equal(details.evidence["parse-invalid-number"].line, 4);
  const markup = renderTimingPanel(node, [], details);
  assert.match(markup, /&lt;top&gt;\.txt/);
  assert.doesNotMatch(markup, /<top>/);
  assert.equal(renderTimingPanel(node, [], null), "");
});

test("merged reports retain unscoped points, source of warnings and legacy dataset defaults", () => {
  const mixed = importTimingSource("k/u1/Z 2 1 -1\nu1/A bad 1 -1\n@module Other\nother/Z 1 1 0",
    { name: "mixed.txt" }).timing;
  const legacy = { module: "constructor", records: [{ point: "port", at: 2 }] };
  const merged = mergeTimingDatasets([mixed, legacy]);
  assert.equal(merged.scopes.__default__[0].point, "k/u1/Z");
  assert.equal(merged.scopes.constructor[0].module, "constructor");
  assert.equal(merged.diagnostics[0].point, "u1/A");
  assert.equal(merged.diagnostics[0].module, null);
  assert.equal(merged.diagnostics[0].fileName, "mixed.txt");
  assert.equal(mixed.records[0].module, null);
  for (const timing of [mixed, merged]) {
    assert.equal(project(timing).nodes.find((node) => node.id === "cell:u1").timing.pins.Z.slack, -1);
  }
  const badJson = importTimingSource('{"module":"Kernel","points":{"u1/Z":[1,2,1],"u2/Z":{"module":"Peer","at":"1e999"}}}').timing;
  assert.equal(badJson.records.length, 1);
  assert.equal(badJson.diagnostics[0].module, "Peer");
});

test("matched sparse reports have a distinct coverage outcome and a failed log write can be retried", () => {
  for (const [rows, count] of [[["u1/Z"], 1], [["a"], 0]]) {
    const timing = table("Kernel", rows);
    const graph = project(timing);
    const reporter = createTimingMatchReporter();
    const log = createProcessLog();
    const context = { requestId: 1 };
    reporter(() => { throw Error("sink failed"); }, graph, timing, context);
    const sink = (level, phase, message, details) => log.append({ level, phase, message, details });
    reporter(sink, graph, timing, context);
    reporter(sink, graph, timing, context);
    const entry = JSON.parse(log.toJsonLines());
    assert.equal(entry.level, "info");
    assert.equal(entry.details.code, "timing.partial-coverage");
    assert.equal(entry.details.unmatchedRecordCount, 0);
    assert.equal(entry.details.annotatedCellCount, count);
  }
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

test("name evidence identifies a rejected child boundary and an exact boundary port", () => {
  const module = parseVerilog(String.raw`module Kernel(input a, output \u1/X );
    BUF u1 (.A(a), .Z(\u1/X ));
    BUF child (.A(a), .Z(spare)); endmodule`).modules[0];
  const graph = project(table("Kernel", ["child/u1/Z", "u1/X"]), module);
  const cell = graph.nodes.find((n) => n.id === "cell:u1");
  const details = missingCellTimingDetails(cell, graph.timingSummary);
  assert.equal(details.evidence["child-instance-boundary"].childBoundary, "child");
  assert.deepEqual(details.evidence["child-instance-boundary"].candidates, ["child/u1/Z"]);
  assert.equal(details.evidence["port-candidate"].point, "u1/X");
  assert.equal(graph.timingSummary.matchedRecordCount, 1);
});

test("ancestor-relative reports resolve pins and ports of the same physical occurrence at either round count", () => {
  for (const root of ["LocalDesign_1of1", "LocalDesign_15of15"]) {
    for (const repeated of [false, true]) {
      const library = parseVerilog(`module Leaf(input a, output z); wire n;
        BUF u1 (.A(a), .Z(n)); BUF u2 (.A(n), .Z(z)); endmodule
        module Mid(input a, output z); Leaf k (.a(a), .z(z)); endmodule
        module ${root}(input a, output z); Mid m (.a(a), .z(z)); ${repeated ? "Mid other (.a(a), .z(x));" : ""} endmodule`).modules;
      const topTiming = table(root, ["m/k/a", "m/k/u1/Z", "m/k/u2/Z", ...(repeated ? ["other/k/u2/A"] : [])]);
      const midTiming = table("Mid", ["k/a", "k/u1/A"]);
      const timing = mergeImportedTiming(topTiming, midTiming);
      const build = (options) => buildWorkspaceGraph(library[0], { moduleLibrary: library, timing, ...options });
      const explicit = { occurrenceRootModuleName: root, occurrencePath: ["m", "k"] };
      for (const options of repeated ? [explicit] : [explicit, {}]) {
        const graph = build(options);
        assert.equal(graph.timingSummary.matchedRecordCount, 5);
        assert.deepEqual(Object.keys(graph.nodes.find((n) => n.id === "cell:u1").timing.pins).sort(), ["A", "Z"]);
        assert.deepEqual(Object.keys(graph.nodes.find((n) => n.id === "cell:u2").timing.pins), ["Z"]);
        assert.equal(graph.nodes.find((n) => n.kind === "input").timing.at, 2);
      }
      if (repeated) {
        assert.equal(build({}).timingSummary.matchedRecordCount, 0);
        assert.equal(build({ occurrencePath: ["m", "k"] }).timingSummary.matchedRecordCount, 5);
      }
    }
  }
});

test("a large parent-scoped report retains every record without exceeding the argument stack", () => {
  const base = table(top, ["k/u1/Z"]);
  const records = Array(140000).fill(base.records[0]);
  const summary = project({ ...base, records, scopes: { [top]: records } }).timingSummary;
  assert.equal(summary.scopedRecordCount, records.length);
  assert.equal(summary.matchedRecordCount, records.length);
  assert.equal(summary.diagnostics.annotatedCellCount, 1);
});

test("a module-local pin and an unscoped hierarchy pin resolve to one cell in either import order", () => {
  const local = table("Kernel", ["u1/A", "u2/Z"]);
  const rooted = importTimingSource("point at rt slack\n" + top + "/k/u1/Z 3 1 -2").timing;
  for (const timing of [mergeImportedTiming(rooted, local), mergeImportedTiming(local, rooted)]) {
    const graph = project(timing);
    assert.equal(graph.timingSummary.matchedRecordCount, 3);
    assert.equal(graph.timingSummary.diagnostics.annotatedCellCount, 2);
    assert.equal(graph.nodes.find((n) => n.id === "cell:u1").timing.pins.Z.slack, -2);
  }
});

test("the same selected instance path under different roots cannot combine pins or ports", () => {
  const library = parseVerilog(`module Kernel(input a, output z); BUF u (.A(a), .Z(z)); endmodule
    module First(input a, output z); Kernel k (.a(a), .z(z)); endmodule
    module Second(input a, output z); Kernel k (.a(a), .z(z)); endmodule`).modules;
  const build = (timing, root) => buildWorkspaceGraph(library[0], {
    moduleLibrary: library, timing, occurrencePath: ["k"], occurrenceRootModuleName: root
  });
  const scoped = mergeImportedTiming(table("First", ["k/u/A", "k/a"]), table("Second", ["k/u/Z", "k/z"]));
  const plain = importTimingSource("First/k/u/A 2 1 -1\nSecond/k/u/Z 2 1 -1\nk/u/A 2 1 -1").timing;
  for (const timing of [scoped, plain]) {
    const summary = build(timing).timingSummary;
    assert.equal(summary.matchedRecordCount, 0);
    assert.deepEqual(summary.occurrenceExamples.slice().sort(), ["First::k", "Second::k"]);
    const selected = build(timing, "First").nodes.find((n) => n.id === "cell:u");
    assert.deepEqual(Object.keys(selected.timing.pins), ["A"]);
  }
  assert.equal(build(plain).timingSummary.diagnostics.excludedReasons["ambiguous-root-path"], 1);
  const bare = importTimingSource("k/u/A 2 1 -1").timing;
  const log = createProcessLog();
  createTimingMatchReporter()((level, phase, message, details) => log.append({ level, phase, message, details }),
    build(bare), bare, { requestId: 1 });
  const entry = JSON.parse(log.toJsonLines());
  assert.equal(entry.level, "warning");
  assert.equal(entry.details.code, "timing.ambiguous-root-path");
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
