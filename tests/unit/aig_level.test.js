import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyAigLevelFile } from "../../src/domains/aig/aig_level.js";
import { importAigSource } from "../../src/domains/aig/aig_import.js";
import { aigFeature } from "../../src/domains/aig/aig_feature.js";

const blif = readFileSync(new URL("../../examples/aig_mapped_names.blif", import.meta.url), "utf8");
const design = { text: blif, name: "mapped.blif", format: "blif" };
const file = text => ({ name: "fixture.level", text });
const apply = (imported, text) => applyAigLevelFile(imported, file(text));
const get = (imported, kind, name) => imported.model.nodes.find(node =>
  node.kind === kind && node.sourceRefs.some(ref => ref.id === name));

test("sparse PI AT propagates by AND cost and recomputes critical paths without renumbering", () => {
  const base = importAigSource(blif, design);
  const seeded = apply(base, "\uFEFF# port mapped in the source\r\n\r\n dp_add_2_cp_temp3_combined/in_96  3\r\n");
  const fromImport = importAigSource(blif, { ...design, levelFile: file("n0 3") });
  assert.deepEqual(fromImport.model, seeded.model);
  assert.deepEqual(seeded.levelFile, { name: "fixture.level", pointCount: 1 });
  assert.equal(seeded.model.hasInputLevelOffsets, true);
  assert.deepEqual(seeded.model.nodes.map(n => n.id), base.model.nodes.map(n => n.id));
  assert.strictEqual(seeded.model.edges, base.model.edges);
  assert.equal(get(base, "pi", "n0").level, 0);
  assert.equal(get(seeded, "pi", "n0").level, 3);
  assert.equal(get(seeded, "pi", "n1").level, 0);
  assert.equal(get(seeded, "and", "n2").level, 4);
  assert.equal(get(seeded, "po", "n3").level, 4);
  assert.equal(get(seeded, "po", "n4").level, 5);
  assert.equal(seeded.analysis.depth, 5);
  assert.ok(seeded.analysis.criticalNodes.includes(get(seeded, "pi", "n0").id));
  assert.ok(!seeded.analysis.criticalNodes.includes(get(seeded, "pi", "n1").id));
});

test("reported metrics merge by resolved object and explicit slack takes precedence", () => {
  const report = apply(importAigSource(blif, design), [
    "rt_level,point,at_level,slack_level,kind",
    "-,n2,12,-,and", "6,w_gen_5291,-,-,and", "6,n2,-,-,and",
    "3,n3,4,-9,-", "-,n0,-,-1,pi"
  ].join("\n"));
  assert.equal(report.levelFile.pointCount, 3);
  assert.equal(report.model.hasInputLevelOffsets, false);
  assert.deepEqual(get(report, "and", "n2").levelReport, { at: 12, rt: 6, slack: -6, slackDerived: true });
  assert.equal(get(report, "and", "n2").level, 1);
  assert.deepEqual(get(report, "po", "n3").levelReport, { at: 4, rt: 3, slack: -9, slackDerived: false });
  assert.deepEqual(get(report, "pi", "n0").levelReport, { at: null, rt: null, slack: -1, slackDerived: false });
  assert.ok(Object.isFrozen(get(report, "and", "n2").levelReport));
});

test("DOT source identifiers, quoted names and optional kind resolve exact objects", () => {
  const dot = 'digraph { edge [dir=back]; p [shape=triangle,label="port, one"]; q [shape=triangle,label="#gate"]; ' +
    'g [label="port, one"]; o [shape=invtriangle,label="port, one"]; g -> p; g -> q; o -> g; }';
  const imported = importAigSource(dot, { format: "dot" });
  const seeded = apply(imported, '"port, one" 7\n"#gate" 2');
  assert.equal(get(seeded, "po", "o").level, 8);
  const report = apply(seeded, 'kind,rt,point\nand,-3,"port, one"\npo,4,o\npi,9,"#gate"');
  assert.equal(get(report, "and", "g").levelReport.rt, -3);
  assert.equal(get(report, "po", "o").levelReport.rt, 4);
  assert.equal(get(report, "pi", "p").level, 0);
  assert.throws(() => apply(imported, 'point rt_level\n"port, one" 2'), { code: "aig.level-ambiguous-point" });

  const quoted = importAigSource('.model quoted\n.inputs sig"x foo[2]/x point\n.outputs y\n.names sig"x y\n1 1\n.end', { format: "blif" });
  const values = apply(quoted, 'point 3\n"sig""x" 4\nfoo[2]/x 2');
  assert.equal(get(values, "pi", 'sig"x').level, 4);
  assert.equal(get(values, "pi", "foo[2]/x").level, 2);
  assert.equal(get(values, "pi", "point").level, 3);
});

test("BLIF driver and PO names prefer the named port, including mapped or aliased outputs", () => {
  const source = "# n2 port_y\n.model lookup\n.inputs a b\n.outputs n2 n3\n.names a b n2\n11 1\n.names a n3\n1 1\n.end";
  const imported = importAigSource(source, { format: "blif" });
  const data = apply(imported, "point rt kind\nport_y 3 -\nn2 4 and\nn3 5 -");
  assert.equal(get(data, "po", "n2").levelReport.rt, 3);
  assert.equal(get(data, "and", "n2").levelReport.rt, 4);
  assert.equal(get(data, "po", "n3").levelReport.rt, 5);
  assert.equal(get(data, "pi", "a").levelReport, undefined);
});

test("folded BLIF aliases report on their driver without setting a primary input's initial level", () => {
  const source = [
    "# a input_a", "# tap internal_tap", "# y output_y",
    ".model aliases", ".inputs a b", ".outputs y out",
    ".names a y", "1 1", ".names a tap", "0 1", ".names tap b out", "11 1", ".end"
  ].join("\n");
  const imported = importAigSource(source, { format: "blif" });
  for (const name of ["y", "tap", "output_y", "internal_tap"]) {
    assert.throws(() => apply(imported, "b 3\n" + name + " 7"), error =>
      error.code === "aig.level-unknown-point" && error.diagnostic.line === 2 && error.diagnostic.file === "fixture.level");
  }
  const reported = apply(imported, "point at_level\ninternal_tap 9\noutput_y 7");
  assert.equal(get(reported, "pi", "a").levelReport.at, 9);
  assert.equal(get(reported, "pi", "a").level, 0);
  assert.equal(get(reported, "po", "y").levelReport.at, 7);
  assert.equal(get(reported, "and", "out").level, 1);
  const seeded = apply(reported, "point at_level\ntap 4\ninput_a 4");
  assert.equal(get(seeded, "pi", "a").level, 4);
  assert.equal(get(seeded, "and", "out").level, 5);
});

test("replacement drops previous seeds and reports and works with permuted arrays", () => {
  const base = aigFeature.importSource(design);
  const seeded = aigFeature.importSource({ ...design, levelFile: file("n0 5") }, { previousDocument: base });
  const replacement = aigFeature.importSource({ ...design, levelFile: file("n1 2") }, { previousDocument: seeded });
  assert.equal(get(seeded.model, "pi", "n0").level, 5);
  assert.equal(get(replacement.model, "pi", "n0").levelReport, undefined);
  assert.equal(get(replacement.model, "pi", "n0").level, 0);
  assert.equal(get(replacement.model, "pi", "n1").level, 2);
  const original = base.model.model;
  const reversed = apply({ ...base.model, model: { ...original, nodes: [...original.nodes].reverse(), edges: [...original.edges].reverse() } }, "n1 2");
  assert.deepEqual(reversed.model.nodes.slice().reverse(), replacement.model.model.nodes);
  assert.equal(reversed.analysis.depth, replacement.model.analysis.depth);
  assert.deepEqual(new Set(reversed.analysis.criticalEdges), new Set(replacement.model.analysis.criticalEdges));
});

test("invalid files retain previous model and diagnose file, line and conflict origin", () => {
  const previous = apply(importAigSource(blif, design), "n0 5");
  for (const [text, code, line] of [
    ["# blank", "row", 1], ["point at_level\n", "row", 1], ["point bad_column\nn0 1", "header", 1],
    ["point at at_level\nn0 1 1", "header", 1], ["n0 -2", "value", 1], ["n0 0x2", "value", 1],
    ["n0 3\nn1 2.0", "value", 2], ["n0 1e2", "value", 1], ["n0 9007199254740992", "value", 1],
    ["point at\nn0 -", "row", 2], ["point rt\nn2 1 2", "row", 2], ['"n0 2', "row", 1],
    ["point rt kind\nn0 1 wire", "row", 2], ["n0 2\nN0 3", "unknown-point", 2],
    ["n2 4", "unknown-point", 1], ["n0 2\ndp_add_2_cp_temp3_combined/in_96 3", "conflict", 2],
    ["n0 9007199254740991", "overflow", 1], ["point rt at\nn2 -9007199254740991 1", "overflow", 2]
  ]) {
    assert.throws(() => apply(previous, text), error => {
      assert.equal(error.code, "aig.level-" + code, text);
      assert.equal(error.diagnostic.file, "fixture.level");
      assert.equal(error.diagnostic.line, line, text);
      if (code === "conflict") assert.match(error.message, /first specified on line 1/);
      return true;
    });
  }
  assert.equal(get(previous, "pi", "n0").level, 5);
  assert.deepEqual(previous.levelFile, { name: "fixture.level", pointCount: 1 });
});
