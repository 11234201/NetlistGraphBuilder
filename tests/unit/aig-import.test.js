import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { importAigSource } from "../../src/domains/aig/aig_import.js";
import { parseBlifSource } from "../../src/domains/aig/blif_parser.js";
import { parseDotSource } from "../../src/domains/aig/dot_parser.js";
import { adaptAndNotBlif } from "../../src/domains/aig/aig_semantics.js";
import { normalizeAig } from "../../src/domains/aig/aig_normalize.js";
import { createAigQuery, buildAigSearchIndex, searchAigIndex } from "../../src/domains/aig/aig_query.js";

const fixture = (name) => readFileSync(new URL(`../fixtures/aig/${name}`, import.meta.url), "utf8");
const blif = (body, inputs = "a b", outputs = "y") => `.model sample\n.inputs ${inputs}\n.outputs ${outputs}\n${body}\n.end\n`;
const importBlif = (text) => importAigSource(text, { format: "blif", name: "sample.blif" });
const geometryModel = (model) => ({ nodes: model.nodes.map(({ sourceRefs, ...node }) => node), edges: model.edges.map(({ sourceRefs, ...edge }) => edge) });

test("real ABC DOT and BLIF produce the same named AIG and exact analysis", () => {
  const dot = importAigSource(fixture("shared_cone.dot"), { format: "abc-dot" });
  const binary = importBlif(fixture("shared_cone.blif"));
  assert.deepEqual(geometryModel(dot.model), geometryModel(binary.model));
  assert.deepEqual(dot.analysis, binary.analysis);
  assert.deepEqual(dot.analysis.counts, { pi: 4, and: 8, po: 3, constant: 0, edges: 19, invertedEdges: 10 });
  assert.equal(dot.analysis.depth, 4);
  assert.equal(dot.analysis.criticalEdges.length, 9);
  assert.equal(Object.values(dot.analysis.fanout).filter((value) => value >= 2).length, 6);
  assert.deepEqual(dot.model.nodes.filter((node) => node.kind === "pi").map((node) => node.label), ["a", "b", "c", "d"]);
  assert.ok(Object.isFrozen(dot.model.nodes[0].sourceRefs));
  assert.throws(() => { dot.model.nodes[0].label = "changed"; }, TypeError);
});

test("both production imports match all 16 original AIGER truth assignments", () => {
  const reference = fixture("shared_cone_reference.aag").trim().split(/\r?\n/);
  const [, , inputCount, latchCount, outputCount, andCount] = reference[0].split(" ").map(Number);
  assert.equal(latchCount, 0);
  const inputs = reference.slice(1, 1 + inputCount).map(Number);
  const outputs = reference.slice(1 + inputCount, 1 + inputCount + outputCount).map(Number);
  const gates = reference.slice(1 + inputCount + outputCount, 1 + inputCount + outputCount + andCount).map((line) => line.split(" ").map(Number));
  const names = new Map(reference.filter((line) => /^o\d+ /.test(line)).map((line) => [Number(line.match(/^o(\d+)/)[1]), line.slice(line.indexOf(" ") + 1)]));
  const expected = outputs.map(() => []);
  for (let assignment = 0; assignment < 1 << inputCount; assignment++) {
    const values = new Map([[0, 0], ...inputs.map((literal, index) => [literal, (assignment >> (inputCount - index - 1)) & 1])]);
    const bit = (literal) => values.get(literal & ~1) ^ (literal & 1);
    for (const [target, first, second] of gates) values.set(target, bit(first) & bit(second));
    outputs.forEach((literal, index) => expected[index].push(bit(literal)));
  }
  for (const name of ["shared_cone.dot", "shared_cone.blif"]) {
    const data = importAigSource(fixture(name), { name });
    outputs.forEach((_, index) => assert.deepEqual(evaluate(data.model, names.get(index)), expected[index], `${name}: ${names.get(index)}`));
  }
});

test("twelve source renamings and permutations per format preserve canonical geometry and analysis", () => {
  const sourceDot = parseDotSource(fixture("shared_cone.dot"));
  const sourceBlif = parseBlifSource(fixture("shared_cone.blif"));
  const expected = importAigSource(fixture("shared_cone.dot"));
  const publicNames = new Set(sourceBlif.declarations.filter((record) => [".inputs", ".outputs"].includes(record.directive)).flatMap((record) => record.arguments));
  for (let seed = 1; seed <= 12; seed++) {
    const renamed = new Map(sourceDot.nodes.map((node, index) => [node.id, `id_${seed}_${(index * 13 + seed * 7) % 991}`]));
    const dotNodes = shuffled(sourceDot.nodes, seed).map((node) => `${JSON.stringify(renamed.get(node.id))} [${Object.entries(node.attributes).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(",")}];`);
    const dotEdges = shuffled(sourceDot.edges, seed + 30).map((edge) => `${JSON.stringify(renamed.get(edge.tail))} -> ${JSON.stringify(renamed.get(edge.head))} [${Object.entries(edge.attributes).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(",")}];`);
    const dot = `digraph {${dotNodes.join("\n")}\n${dotEdges.join("\n")}}`;
    const rename = (name) => publicNames.has(name) ? name : `signal_${seed}_${name.split("").reverse().join("")}`;
    const tables = shuffled(sourceBlif.declarations.filter((record) => record.directive === ".names"), seed).map((record) => {
      const args = record.arguments.map(rename);
      const swap = args.length === 3 && seed % 2;
      if (swap) [args[0], args[1]] = [args[1], args[0]];
      return `.names ${args.join(" ")}\n${record.rows.map((row) => `${swap ? row.fields[0].split("").reverse().join("") : row.fields[0]} ${row.fields[1]}`).join("\n")}`;
    });
    const blifText = `.model permuted\n.inputs ${shuffled(["a", "b", "c", "d"], seed).join(" ")}\n.outputs ${shuffled(["y", "shared", "masked"], seed).join(" ")}\n${tables.join("\n")}\n.end`;
    for (const [text, format] of [[dot, "abc-dot"], [blifText, "blif"]]) {
      const data = importAigSource(text, { format });
      assert.deepEqual(geometryModel(data.model), geometryModel(expected.model), `${format} seed ${seed}`);
      assert.deepEqual(data.analysis, expected.analysis, `${format} seed ${seed}`);
    }
  }
});

test("AND duplicates preserve independent objects, context, multiplicity and paired-format identity", () => {
  const first = importBlif(fixture("duplicate_and.blif"));
  const second = importAigSource(fixture("duplicate_and.dot"), { format: "abc-dot" });
  assert.deepEqual(geometryModel(first.model), geometryModel(second.model));
  assert.equal(first.analysis.counts.and, 3);
  const renamed = fixture("duplicate_and.blif").replaceAll("first", "zzz").replaceAll("second", "aaa");
  assert.deepEqual(geometryModel(first.model), geometryModel(importBlif(renamed).model));
});

test("symmetric duplicate AND identities and permuted statements normalize without merging", () => {
  const original = blif(".names a b left\n11 1\n.names a b right\n11 1\n.names left right y\n11 1");
  const permuted = blif(".names zz aa y\n11 1\n.names b a aa\n11 1\n.names b a zz\n11 1", "b a");
  const first = importBlif(original);
  const second = importBlif(permuted);
  assert.deepEqual(geometryModel(first.model), geometryModel(second.model));
  assert.equal(first.analysis.counts.and, 3);
  assert.equal(new Set(first.model.nodes.filter((node) => node.kind === "and").map((node) => node.id)).size, 3);
});

test("non-twin symmetric branches use canonical identities independent of source names", () => {
  const body = ".names a b g1\n11 1\n.names a b g2\n11 1\n.names a b g3\n11 1\n.names g1 g2 p\n11 1\n.names g2 g3 q\n11 1\n.names g3 g1 r\n11 1\n.names p q s\n11 1\n.names r s y\n11 1";
  const renamed = body.replace(/\b(g1|g2|g3|p|q|r|s)\b/g, (value) => ({ g1: "zz", g2: "aa", g3: "mm", p: "kk", q: "hh", r: "ee", s: "tt" })[value]);
  const blocks = renamed.split(/(?=\.names)/).filter(Boolean).reverse().map((block) => block.trim()).join("\n");
  assert.deepEqual(geometryModel(importBlif(blif(body)).model), geometryModel(importBlif(blif(blocks)).model));
});

test("BUF/NOT chains, output inversion and OFF covers preserve truth table and source aliases", () => {
  const data = importBlif(blif(".names a na\n0 1\n.names na copy\n1 1\n.names copy b y\n11 0"));
  assert.equal(data.analysis.counts.and, 1);
  assert.equal(data.analysis.counts.invertedEdges, 2);
  const input = data.model.nodes.find((node) => node.label === "a");
  assert.deepEqual(input.sourceRefs.map((ref) => [ref.id, ref.inverted]), [["a", false], ["copy", true], ["na", true]]);
  assert.deepEqual(evaluate(data.model), [1, 0, 1, 1]);
});

test("zero-input constants, direct outputs and unused constants are supported", () => {
  const constant = importBlif(blif(".names y\n1", ""));
  assert.equal(constant.analysis.counts.constant, 1);
  assert.equal(constant.analysis.counts.pi, 0);
  assert.equal(constant.model.edges[0].inverted, true);
  assert.equal(constant.analysis.depth, 0);
  const direct = importBlif(blif(".names unused\n0", "a", "a"));
  assert.equal(direct.analysis.counts.constant, 0);
  assert.equal(direct.model.provenance.find((ref) => ref.id === "unused").nodeId, null);
  assert.equal(direct.analysis.counts.edges, 1);
});

test("two-input ON and OFF covers implement all sixteen Boolean functions", () => {
  const assignments = ["00", "01", "10", "11"];
  for (let mask = 0; mask < 16; mask++) {
    const expected = assignments.map((_, bit) => (mask >> bit) & 1);
    for (const phase of [0, 1]) {
      // BLIF's empty table is always 0; a full don't-care cube expresses the other constant.
      const cubes = assignments.filter((_, bit) => expected[bit] === phase);
      const cover = cubes.length ? cubes.map((cube) => cube + " " + phase) : ["-- " + (1 - phase)];
      const make = (rows, swapped) => importBlif(blif(".names " + (swapped ? "b a" : "a b") + " y\n" + rows.join("\n")));
      const one = make(cover, false);
      const two = make([...cover, cover[0]].reverse().map((row) => row[1] + row[0] + row.slice(2)), true);
      assert.deepEqual(evaluate(one.model), expected);
      assert.deepEqual(geometryModel(one.model), geometryModel(two.model));
      if (mask === 6 || mask === 9) {
        assert.equal(one.analysis.counts.and, 3);
        assert.equal(one.analysis.depth, 2);
        assert.equal(one.model.nodes.filter((node) => node.sourceRefs.some((ref) => ref.generatedFor === "y")).length, 2);
      }
    }
  }
  assert.deepEqual(evaluate(importBlif(blif(".names a b y\n-1 1\n1- 1")).model), [0, 1, 1, 1]);
  assert.deepEqual(evaluate(importBlif(blif(".names a a y\n01 1\n10 1", "a")).model), [0, 0]);
});

test("invalid cover, input count and post-expansion budget carry the offending .names location", () => {
  for (const [body, code, line, inputCount] of [
    [".names a b y\nxx 1", "blif.cover-value", 5, 2],
    [".names a b c y\n1-- 1", "blif.input-count", 4, 3]
  ]) {
    assert.throws(() => importBlif(blif(body)), (error) =>
      error.code === code && error.diagnostic.line === line && error.diagnostic.column === 1 &&
      error.diagnostic.objectId === "y" && error.diagnostic.inputCount === inputCount);
  }
  const inputs = Array.from({ length: 99997 }, (_, i) => "a" + i).join(" ");
  assert.throws(() => adaptAndNotBlif(parseBlifSource(blif(".names a0 a1 y\n01 1\n10 1", inputs))),
    (error) => error.code === "blif.object-limit" && error.diagnostic.objectId === "y");
});

test("indented BLIF diagnostics locate the first conflicting row following a continued declaration", () => {
  const header = ["    .names a \\", "   b y"].join("\n");
  const source = blif(header + "\n  01 1\n      10 0");
  assert.throws(() => importBlif(source), ({ diagnostic }) => diagnostic.code === "blif.cover-phase" &&
    diagnostic.line === 7 && diagnostic.column === 7 && diagnostic.objectId === "y");
  const declaration = parseBlifSource(source).declarations.find((row) => row.directive === ".names");
  assert.deepEqual([declaration.line, declaration.column], [4, 5]);
});

test("BLIF search uses the matched signal polarity and the port's own mapping among folded aliases", () => {
  const text = ["# a top/not_z", "# z top/input", "# pos shared", "# neg shared"].join("\n") + "\n" +
    blif(".names z a\n0 1\n.names z raw\n0 1\n.names z pos\n1 1\n.names z neg\n0 1", "z", "raw");
  const { model } = importBlif(text);
  const index = buildAigSearchIndex(model);
  const pi = (term) => searchAigIndex(index, term).find((row) => row.kind === "pi");
  assert.equal(pi("").label, "top/input");
  assert.equal(pi("a").label, "top/not_z");
  assert.match(pi("a").detail, /a \(inverted\)/);
  assert.equal(pi("raw").label, "raw");
  assert.match(pi("raw").detail, /raw \(inverted\)/);
  assert.match(pi("shared").detail, /neg \(inverted\), pos →/);
  const ambiguous = importBlif("# a z\n" + blif(".names z a\n0 1", "z", "z")).model;
  const hit = searchAigIndex(buildAigSearchIndex(ambiguous), "z").find((row) => row.kind === "pi");
  assert.match(hit.detail, /a \(inverted\), z →/);
});

test("exact port names are visible even when substring matches exceed the global search limit", () => {
  const names = Array.from({ length: 110 }, (_, index) => "a" + index);
  const comments = names.map((id) => `# ${id} block/out[${id}]`).concat("# z block/out");
  const imported = importBlif(comments.join("\n") + "\n" + blif("", names.concat("z").join(" "), "z"));
  const hits = searchAigIndex(buildAigSearchIndex(imported.model), "BLOCK/OUT", 2);
  assert.deepEqual(hits.map((row) => [row.kind, row.label]), [["pi", "block/out"], ["po", "block/out"]]);
});

test("an output port's own exact name precedes its folded driver in raw and mapped name searches", () => {
  const logic = blif(".names island_input island_output\n0 1", "island_input", "island_output");
  for (const prefix of ["", "# island_output design/out\n"]) {
    const { model } = importBlif(prefix + logic);
    const index = buildAigSearchIndex(model);
    const outputId = model.nodes.find((node) => node.kind === "po").id;
    const driverId = model.nodes.find((node) => node.kind === "pi").id;
    for (const term of prefix ? ["island_output", "design/out"] : ["island_output"]) {
      assert.deepEqual(searchAigIndex(index, term, 1).map((row) => row.id), [outputId]);
      const both = searchAigIndex(index, term, 2);
      assert.deepEqual(both.map((row) => row.id), [outputId, driverId]);
      assert.match(both[1].detail, /island_output \(inverted\)/);
    }
  }
});

test("BLIF source names bind after numbering, preserve alias polarity and distinguish driver and output uses", () => {
  const source = blif(".names n0 n1\n0 1\n.names n1 n2 n3\n01 1\n10 1", "n0 n2", "n1 n3");
  const comments = ["# n0 top/input<&>", "# n1 top/inverted", "# n3 out", "# n2 duplicate", "# n2 other", "# n0 top/input<&>", "# n88 unknown", "# ordinary comment"];
  const imported = importBlif(comments.join("\n") + "\n" + source);
  const { model } = imported;
  assert.equal(model.nameMappings.length, 8);
  const first = model.nodes.find((node) => node.kind === "pi" && node.label === "n0");
  assert.equal(first.primaryNameMapping.name, "top/input<&>");
  const alias = model.nameMappings.filter((m) => m.signalId === "n1");
  assert.deepEqual(alias.map((m) => [m.usage, m.inverted]), [["driver", true], ["output", false]]);
  assert.equal(alias[0].nodeId, first.id);
  assert.equal(model.nodes.find((n) => n.id === alias[1].nodeId).kind, "po");
  const conflicting = model.nodes.find((n) => n.label === "n2");
  assert.equal(conflicting.nameMappings.length, 2);
  assert.ok(conflicting.nameMappings.every((m) => m.conflict));
  assert.equal(model.mappingWarnings.unknownCount, 1);
  assert.equal(model.mappingWarnings.conflictCount, 1);
  assert.equal(model.nameMappings.find((m) => m.signalId === "n88").nodeId, null);
  assert.ok(!model.nameMappings.some((m) => m.signalId === "ordinary"));
  assert.ok(model.nodes.filter((n) => n.sourceRefs.some((ref) => ref.generatedFor)).every((n) => !n.nameMappings));
  const search = searchAigIndex(buildAigSearchIndex(model), "inverted");
  assert.deepEqual(new Set(search.map((hit) => hit.id)), new Set(alias.map((m) => m.nodeId)));
  assert.ok(search.every((hit) => hit.label === "top/inverted" && hit.detail.includes("n1")));
  const bare = importBlif(source);
  assert.deepEqual(model.edges.map((e) => [e.id, e.source, e.target, e.inverted]), bare.model.edges.map((e) => [e.id, e.source, e.target, e.inverted]));
  assert.deepEqual(model.nodes.map((n) => [n.id, n.kind, n.level, n.label]), bare.model.nodes.map((n) => [n.id, n.kind, n.level, n.label]));
  const reordered = importBlif(comments.reverse().join("\n") + "\n" + source);
  const uses = (graph) => graph.nameMappings.map(({ line, ...binding }) => binding);
  assert.deepEqual(uses(reordered.model), uses(model));
});

test("duplicate fanin slots and same-source mixed polarity remain separately addressable", () => {
  const data = importBlif(blif(".names a a y\n10 1", "a"));
  const gate = data.model.nodes.find((node) => node.kind === "and");
  const query = createAigQuery(data.model, data.analysis);
  const edges = query.connections(gate.id).incoming;
  assert.equal(edges.length, 2);
  assert.notEqual(edges[0].id, edges[1].id);
  assert.equal(edges[0].source, edges[1].source);
  assert.notEqual(edges[0].inverted, edges[1].inverted);
  assert.equal(data.analysis.fanout[edges[0].source], 2);
  assert.equal(query.getObject(edges[0].id), edges[0]);
});

test("critical edges are determined independently from endpoint membership", () => {
  const data = importBlif(blif(".names a b c\n11 1\n.names c b d\n11 1\n.names a d y\n11 1"));
  const selected = new Set(data.analysis.criticalNodes);
  const bypass = data.model.edges.find((edge) => selected.has(edge.source) && selected.has(edge.target) && !data.analysis.criticalEdges.includes(edge.id));
  assert.ok(bypass, "short edge between critical nodes must stay unhighlighted");
});

test("Unicode names and markup remain plain source text, searchable with source IDs", () => {
  const data = importBlif(blif(".names 信号<1> out&\n1 1", "信号<1>", "out&"));
  const index = buildAigSearchIndex(data.model);
  assert.equal(searchAigIndex(index, "信号<1>")[0].label, "信号<1>");
  assert.equal(searchAigIndex(index, "", 0).length, 0);
  assert.equal(searchAigIndex(index, "", Number.MAX_SAFE_INTEGER).length, data.model.nodes.length);
});

test("syntax and semantic source records remain immutable during normalization", () => {
  const source = parseBlifSource(blif(".names a b y\n11 1"));
  const before = structuredClone(source);
  const raw = adaptAndNotBlif(source);
  const rawBefore = structuredClone(raw);
  normalizeAig(raw);
  assert.deepEqual(source, before);
  assert.deepEqual(raw, rawBefore);
});

test("DOT scopes/defaults, chains, comments and repeated attributes are parsed structurally", () => {
  const text = 'digraph "名字" { edge [dir=back]; { node [shape=triangle]; "a a" [label="输入\\\"x"]; b; } g [shape=ellipse]; o [shape=invtriangle][label="out"]; g -> "a a"; g -> b [style=dotted]; o -> g; }';
  const data = importAigSource(text, { format: "abc-dot" });
  assert.equal(data.analysis.counts.pi, 2);
  assert.equal(data.model.nodes.find((node) => node.kind === "po").label, "out");
  assert.equal(data.analysis.counts.invertedEdges, 1);
  assert.ok(data.model.nodes.some((node) => node.label === '输入"x'));
});

test("quoted DOT punctuation and keywords remain object identities in every endpoint position", () => {
  const expected = importBlif(blif(".names a b y\n11 1"));
  const names = ["{", "}", "[", "]", ";", ",", "=", "+", "->", ":", "subgraph", "node", "edge", "graph", "strict", "digraph", "NoDe", "sUbGrApH"];
  for (const name of names) for (let role = 0; role < 4; role++) {
    const ids = ["input_a", "input_b", "gate", "output"];
    ids[role] = name;
    const [first, second, gate, output] = ids.map((id) => JSON.stringify(id));
    const text = `digraph ${JSON.stringify(name)} { edge [dir=back];
      ${first} [shape=triangle,label="a"]; ${second} [shape=triangle,label="b"];
      ${gate} [shape=ellipse]; ${output} [shape=invtriangle,label="y"];
      ${gate} -> ${first}; ${gate} -> ${second}; ${output} -> ${gate}; }`;
    const actual = importAigSource(text, { format: "abc-dot" });
    assert.deepEqual(geometryModel(actual.model), geometryModel(expected.model), `${name}, role ${role}`);
    assert.deepEqual(actual.analysis, expected.analysis, `${name}, role ${role}`);
    assert.equal(actual.source.name, name);
  }
  const attributes = parseDotSource('digraph { a ["["="]", ";"=",", "+"="->", ":"="="]; }').nodes[0].attributes;
  assert.deepEqual({ ...attributes }, { "[": "]", ";": ",", "+": "->", ":": "=" });
  const joined = parseDotSource('digraph "{" + "}" { "rank" + "dir" = BT; "a" + "b"; }');
  assert.equal(joined.name, "{}");
  assert.deepEqual(joined.nodes.map((node) => node.id), ["ab"]);
});

test("DOT keywords are case insensitive while quoted identities preserve their spelling", () => {
  const text = `DiGrApH demo { GrApH [rankdir=BT]; EdGe [dir=back];
    SuBgRaPh inputs { NoDe [shape=triangle]; a; b; }
    "EdGe" [shape=ellipse]; y [shape=invtriangle]; "EdGe" -> {a;b}; y -> "EdGe"; }`;
  const actual = importAigSource(text, { format: "abc-dot" });
  const expected = importBlif(blif(".names a b y\n11 1"));
  assert.deepEqual(geometryModel(actual.model), geometryModel(expected.model));
  assert.deepEqual(actual.analysis, expected.analysis);
  assert.ok(actual.model.provenance.some((entry) => entry.id === "EdGe"));
  assert.throws(() => importAigSource("StRiCt DiGrApH { }"), /Strict DOT is not supported/);
});

test("missing DOT labels preserve literal source IDs like a single explicit node-name substitution", () => {
  for (const inputId of [String.raw`port\Nname`, String.raw`port\nname`, String.raw`port\\name`]) {
    const outputId = `out_${inputId}`;
    const source = `digraph { edge[dir=back]; "${inputId}"[shape=triangle];
      "${outputId}"[shape=invtriangle]; "${outputId}" -> "${inputId}"; }`;
    const implicit = importAigSource(source);
    const explicit = importAigSource(source.replaceAll("[shape=", String.raw`[label="\N",shape=`));
    // Source IDs are canonical data. Unlike Graphviz's drawing pass, default
    // names and the result of a \N substitution are not decoded a second time.
    assert.equal(implicit.model.nodes.find((node) => node.kind === "pi").label, inputId);
    assert.equal(implicit.model.nodes.find((node) => node.kind === "po").label, outputId);
    assert.equal(implicit.model.provenance.find((entry) => entry.id === inputId).label, inputId);
    assert.deepEqual(geometryModel(implicit.model), geometryModel(explicit.model));
    assert.deepEqual(implicit.analysis, explicit.analysis);
  }
});

test("unsupported syntax, multiple drivers, missing signals, cycles and conflicts report source diagnostics", () => {
  const cases = [
    [blif(".names a missing y\n11 1"), /Undefined signal/],
    [blif(".names z y\n1 1\n.names y z\n1 1"), /cycle/],
    [blif(".names a y y\n1- 1"), /cycle/],
    [blif(".names a missing y\n-- 1"), /Undefined signal/],
    [blif(".names a b c y\n111 1"), /two inputs/],
    [blif(".names a b y\n11 1\n.names a y\n1 1"), /Multiple/],
    [blif(".latch a y"), /Unsupported/],
    [blif(".names a b y\n11 1\n00 0"), /Mixed/],
    [blif(".names a b y\n11 1", "a a"), /Duplicate/],
    [blif(".names a b y\n11 1", "a b", "y y"), /Duplicate/]
  ];
  for (const [text, pattern] of cases) assert.throws(() => importBlif(text), (error) => pattern.test(error.message) && error.diagnostic.file === "sample.blif");
  assert.throws(() => importAigSource('digraph { a [shape=triangle]; o [shape=invtriangle]; o -> a; }'), /dir=back/);
  assert.throws(() => importAigSource('digraph { a [label=<b>]; }'), /HTML labels/);
  assert.throws(() => importAigSource('digraph { a [label="unterminated]; }'), /Unterminated/);
});

test("long chains normalize iteratively without call-stack growth", () => {
  let body = "";
  for (let index = 0; index < 1200; index++) body += `.names ${index ? `g${index - 1}` : "a"} b g${index}\n11 1\n`;
  body += ".names g1199 y\n1 1";
  const data = importBlif(blif(body));
  assert.equal(data.analysis.depth, 1200);
  assert.equal(data.analysis.counts.and, 1200);
});

test("wide source arrays freeze and analyze without argument-list stack limits", () => {
  const names = Array.from({ length: 10000 }, (_, index) => `input_${index}`);
  const data = importBlif(blif("", names.join(" "), names.join(" ")));
  assert.equal(data.analysis.counts.pi, names.length);
  assert.equal(data.analysis.counts.po, names.length);
  assert.equal(data.analysis.criticalEdges.length, names.length);
});

function evaluate(model, outputName) {
  const inputs = model.nodes.filter((node) => node.kind === "pi");
  const output = model.nodes.find((node) => node.kind === "po" && (!outputName || node.label === outputName));
  const incoming = new Map(model.nodes.map((node) => [node.id, model.edges.filter((edge) => edge.target === node.id)]));
  return Array.from({ length: 1 << inputs.length }, (_, assignment) => {
    const values = new Map(inputs.map((node, index) => [node.id, (assignment >> (inputs.length - index - 1)) & 1]));
    for (const node of model.nodes) {
      if (node.kind === "pi") continue;
      const bits = incoming.get(node.id).map((edge) => values.get(edge.source) ^ Number(edge.inverted));
      values.set(node.id, node.kind === "constant" ? 0 : node.kind === "and" ? bits[0] & bits[1] : bits[0]);
    }
    return values.get(output.id);
  });
}

function shuffled(values, seed) {
  const result = [...values];
  let state = seed;
  for (let index = result.length - 1; index > 0; index--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const target = state % (index + 1);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

test("normalization rejects inconsistent alias and constant arity at the source object", () => {
  const raw = adaptAndNotBlif(parseBlifSource(blif(".names a b y\n11 1")));
  const y = raw.nodes.find((node) => node.id === "y");
  for (const kind of ["alias", "constant"]) {
    const input = { ...raw, nodes: raw.nodes.map((n) => n === y ? { ...n, kind } : n) };
    assert.throws(() => normalizeAig(input), /literal/i);
  }
});
