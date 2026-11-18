import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeAigStructure, getAigStructureDetail } from "../../src/domains/aig/structure_analysis.js";
import { classifyStructureFunction } from "../../src/domains/aig/structure_functions.js";
import { structureFunctionAtUse } from "../../src/domains/aig/structure_query.js";
import { importAigSource } from "../../src/domains/aig/aig_import.js";

function builder(names = ["a", "b", "c"]) {
  const nodes = names.map((id) => ({ id, label: id, kind: "pi", level: 0, sourceRefs: [] })), edges = [];
  function and(id, first, second) {
    const fanins = [first, second].map((value) => typeof value === "string" ? [value, false] : value);
    nodes.push({ id, label: id, kind: "and", level: 1 + Math.max(...fanins.map(([id]) => nodes.find((node) => node.id === id).level)), sourceRefs: [] });
    fanins.forEach(([source, inverted], slot) => edges.push({ id: `${id}:${slot}`, source, target: id, inverted, slot, sourceRefs: [] }));
    return id;
  }
  return { nodes, edges, and };
}
function evaluate(model, root, inputs) {
  const values = new Map(Object.entries(inputs));
  for (const node of [...model.nodes].sort((a, b) => a.level - b.level)) {
    if (node.kind === "constant") values.set(node.id, 0);
    if (node.kind !== "and") continue;
    values.set(node.id, model.edges.filter((edge) => edge.target === node.id).reduce((value, edge) => value & (values.get(edge.source) ^ Number(edge.inverted)), 1));
  }
  return values.get(root);
}
function represented(block, assignment) {
  const pin = (role) => assignment[block.pins[role].nodeId] ^ Number(block.pins[role].inverted);
  const result = block.kind === "xor" ? pin("a") ^ pin("b") : block.kind === "xnor" ? 1 ^ pin("a") ^ pin("b") : pin("s") ? pin("d1") : pin("d0");
  return result ^ Number(block.outputInverted ?? false);
}
function verifyPins(block, graph) {
  for (let row = 0; row < (1 << block.inputIds.length); row++) {
    const assignment = Object.fromEntries(block.inputIds.map((id, bit) => [id, (row >> bit) & 1]));
    assert.equal(represented(block, assignment), evaluate(graph, block.rootId, assignment));
  }
}
function permutations(items) { return items.length ? items.flatMap((item, index) => permutations(items.filter((_, other) => index !== other)).map((rest) => [item, ...rest])) : [[]]; }

test("XOR/XNOR exhaust all 16 input/output transformations and preserve output-use polarity", () => {
  let checked = 0;
  const functions = new Set();
  for (const [a, b] of permutations(["a", "b"])) for (let mask = 0; mask < 4; mask++) for (let output = 0; output < 2; output++) {
    const graph = builder(["a", "b"]);
    graph.and("p", [a, Boolean(mask & 1)], [b, Boolean(mask & 2)]);
    graph.and("q", [a, !Boolean(mask & 1)], [b, !Boolean(mask & 2)]);
    graph.and("root", ["p", true], ["q", true]);
    graph.nodes.push({ id: "out", kind: "po", level: 2 });
    graph.edges.push({ id: "out:0", source: "root", target: "out", inverted: Boolean(output), slot: 0 });
    const result = analyzeAigStructure(graph), block = result.blocks.results.find((block) => block.rootId === "root" && block.inputIds.length === 2);
    assert.ok(block); verifyPins(block, graph); functions.add(block.truthTable); checked++;
    const atUse = structureFunctionAtUse(block, Boolean(output));
    for (let row = 0; row < 4; row++) {
      const assignment = { a: row & 1, b: (row >> 1) & 1 };
      assert.equal(represented(atUse, assignment), assignment[a] ^ assignment[b] ^ Boolean(mask & 1) ^ Boolean(mask & 2) ^ output);
    }
  }
  assert.equal(checked, 16); assert.equal(functions.size, 2);
});

test("MUX exhausts all 96 transformations, recovers pins, and classifies exactly 24 functions", () => {
  let checked = 0;
  const functions = new Set();
  for (const [s, d0, d1] of permutations(["a", "b", "c"])) for (let mask = 0; mask < 8; mask++) for (let output = 0; output < 2; output++) {
    const graph = builder();
    graph.and("p", [s, Boolean(mask & 1)], [d1, Boolean(mask & 4)]);
    graph.and("q", [s, !Boolean(mask & 1)], [d0, Boolean(mask & 2)]);
    graph.and("root", ["p", true], ["q", true]);
    const block = analyzeAigStructure(graph).blocks.results.find((block) => block.rootId === "root" && block.kind === "mux");
    assert.ok(block); verifyPins(block, graph); functions.add(block.truthTable); checked++;
    const atUse = structureFunctionAtUse(block, Boolean(output));
    assert.deepEqual(atUse.pins.s, block.pins.s);
    for (let row = 0; row < 8; row++) {
      const assignment = { a: row & 1, b: (row >> 1) & 1, c: (row >> 2) & 1 };
      const expected = (assignment[s] ^ Boolean(mask & 1)) ? assignment[d1] ^ Boolean(mask & 4) : assignment[d0] ^ Boolean(mask & 2);
      // The AIG root is the NOR of the two product terms.
      assert.equal(represented(atUse, assignment), expected ^ 1 ^ output);
    }
  }
  assert.equal(checked, 96); assert.equal(functions.size, 24);
  assert.equal(Array.from({ length: 256 }, (_, truth) => classifyStructureFunction(truth, 3)).filter(Boolean).length, 24);
  assert.equal(Array.from({ length: 16 }, (_, truth) => classifyStructureFunction(truth, 2)).filter(Boolean).length, 2);
});

test("cut search recognizes rewritten and shared blocks; fixed patterns survive a one-cut cache", () => {
  const graph = builder(["a", "b"]);
  graph.and("p", "a", "b"); graph.and("q", ["a", true], ["b", true]);
  graph.and("x", ["p", true], ["q", true]); graph.and("rewritten", "x", "x"); graph.and("load", "p", "a");
  const result = analyzeAigStructure(graph);
  assert.ok(result.blocks.results.some((block) => block.rootId === "rewritten" && block.kind === "xor"));
  const limited = analyzeAigStructure(graph, { cutsPerNode: 1 });
  assert.ok(limited.blocks.results.some((block) => block.rootId === "x" && block.kind === "xor"));
  assert.equal(limited.blocks.status, "partial");
  assert.equal(new Set(result.blocks.results.map((block) => block.id)).size, result.blocks.results.length);
});

test("degenerate MUX classifies by actual function, with no guessed three-input MUX", () => {
  const graph = builder(["s", "a"]);
  graph.and("p", "s", ["a", true]); graph.and("q", ["s", true], "a"); graph.and("r", ["p", true], ["q", true]);
  const blocks = analyzeAigStructure(graph).blocks.results;
  assert.equal(blocks.filter((block) => block.rootId === "r").length, 1);
  assert.equal(blocks.find((block) => block.rootId === "r").kind, "xnor");
  const equal = builder(["s", "a"]);
  equal.and("p", "s", "a"); equal.and("q", ["s", true], "a"); equal.and("r", ["p", true], ["q", true]);
  assert.equal(analyzeAigStructure(equal).blocks.results.filter((block) => block.rootId === "r").length, 0);
});

function oraclePairs(graph) {
  const outgoing = new Map(graph.nodes.map((node) => [node.id, graph.edges.filter((edge) => edge.source === node.id)]));
  function paths(from, to, path = [from]) { return from === to ? [path] : outgoing.get(from).flatMap((edge) => paths(edge.target, to, [...path, edge.target])); }
  const result = [];
  for (const stem of graph.nodes.filter((node) => ["pi", "and"].includes(node.kind))) for (const merge of graph.nodes.filter((node) => node.kind === "and" && node.id !== stem.id)) {
    const candidates = paths(stem.id, merge.id);
    if (candidates.some((a, i) => candidates.slice(i + 1).some((b) => a[1] !== b[1] && a.slice(1, -1).every((id) => !b.slice(1, -1).includes(id))))) result.push(JSON.stringify([stem.id, merge.id]));
  }
  return result.sort();
}
function checkReconvergence(graph) {
  const analyzed = analyzeAigStructure(graph), results = analyzed.reconvergence.results;
  assert.equal(analyzed.reconvergence.status, "complete");
  assert.deepEqual(results.map((result) => JSON.stringify([result.stemId, result.mergeId])).sort(), oraclePairs(graph));
  for (const result of results) {
    const [a, b] = result.paths;
    assert.ok(a.nodeIds.slice(1, -1).every((id) => !b.nodeIds.slice(1, -1).includes(id)));
    for (const path of result.paths) path.edgeIds.forEach((id, i) => {
      const edge = graph.edges.find((edge) => edge.id === id);
      assert.equal(edge.source, path.nodeIds[i]); assert.equal(edge.target, path.nodeIds[i + 1]);
    });
  }
  return analyzed;
}

test("reconvergence matches an independent all-path oracle on 100 small DAGs", () => {
  let random = 271828;
  const next = (maximum) => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random % maximum; };
  for (let sample = 0; sample < 100; sample++) {
    const graph = builder();
    for (let i = 0; i < 6; i++) graph.and(`g${i}`, [graph.nodes[next(graph.nodes.length)].id, Boolean(next(2))], [graph.nodes[next(graph.nodes.length)].id, Boolean(next(2))]);
    checkReconvergence(graph);
  }
});

test("two-path search reroutes an initially conflicting witness and excludes shared tails", () => {
  const graph = builder(["s", "p", "q"]);
  graph.and("a", "s", "p"); graph.and("b", "a", "p"); graph.and("e", "s", "q");
  graph.and("c", "a", "e"); graph.and("d", "b", "q"); graph.and("t", "c", "d"); graph.and("tail", "t", "p");
  const analysis = checkReconvergence(graph);
  assert.ok(analysis.reconvergence.results.some((result) => result.stemId === "s" && result.mergeId === "t"));
  assert.ok(!analysis.reconvergence.results.some((result) => result.stemId === "s" && result.mergeId === "tail"));
});

test("a witness budget exhausted exactly between stems still reports partial coverage", () => {
  const graph = builder(["s1", "s2", "p", "q"]);
  for (const stem of ["s1", "s2"]) {
    graph.and(`${stem}a`, stem, "p"); graph.and(`${stem}b`, stem, "q");
    graph.and(`${stem}t`, `${stem}a`, `${stem}b`);
  }
  const complete = analyzeAigStructure(graph).reconvergence;
  assert.equal(complete.results.length, 2);
  const limited = analyzeAigStructure(graph, { witnessItems: 10 }).reconvergence;
  assert.equal(limited.results.length, 1); assert.equal(limited.witnessItems, 10);
  assert.equal(limited.status, "partial"); assert.ok(limited.reasons.includes("witness-limit"));
  const undersized = analyzeAigStructure(graph, { witnessItems: 9 }).reconvergence;
  assert.equal(undersized.witnessItems, 0, "only retained witness items count as stored");
  assert.equal(undersized.status, "partial");
});

test("real imported preview fixture has six reconvergences, three blocks and exact path details", () => {
  const imported = importAigSource(readFileSync(new URL("../fixtures/aig/structure_analysis.blif", import.meta.url), "utf8"), { format: "blif" });
  const graph = imported.model, snapshot = JSON.stringify(imported), analysis = checkReconvergence(graph);
  assert.equal(analysis.reconvergence.results.length, 6);
  // Existing two-input work units cover this entire fixture in 392 visits.
  const budgeted = analyzeAigStructure(graph, { reconvergenceWork: 392 }).reconvergence;
  assert.equal(budgeted.status, "complete");
  assert.deepEqual(budgeted.results, analysis.reconvergence.results);
  assert.equal(analysis.blocks.results.length, 3);
  assert.deepEqual(analysis.blocks.results.map((block) => block.kind).sort(), ["mux", "xnor", "xor"]);
  const a = graph.nodes.find((node) => node.label === "a"), mux = analysis.blocks.results.find((block) => block.kind === "mux");
  const result = analysis.reconvergence.results.find((result) => result.stemId === a.id && result.mergeId === mux.rootId);
  const detail = getAigStructureDetail(graph, result, analysis.policy);
  assert.equal(detail.status, "complete"); assert.equal(detail.nodeIds.length, 10); assert.equal(detail.edgeIds.length, 12);
  assert.ok(detail.nodeIds.every((id) => graph.nodes.find((node) => node.id === id).kind !== "po"));
  assert.equal(JSON.stringify(imported), snapshot);
  assert.deepEqual(analyzeAigStructure({ nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() }), analysis);
  const limited = analyzeAigStructure(graph, { blockWork: 1, reconvergenceWork: 1 });
  assert.equal(limited.status, "partial"); assert.ok(limited.blocks.reasons.length);
  assert.equal(getAigStructureDetail(graph, result, { detailWork: 1 }).status, "partial");
});
