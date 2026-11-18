import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { importAigSource } from "../../src/domains/aig/aig_import.js";
import { createAigQuery } from "../../src/domains/aig/aig_query.js";
import { analyzeAigStructure } from "../../src/domains/aig/structure_analysis.js";
import { createStructureQuery } from "../../src/domains/aig/structure_query.js";
import { createStructurePresentation } from "../../src/domains/aig/structure_presentation.js";
import { renderAigStructureNavigator, renderAigStructureInspector } from "../../src/ui/aig_structure_panels.js";

test("block labels clear nodes across index cells and avoid labels already placed", () => {
  const nodes = [
    { id: "first", x: 100, y: 149, width: 14, height: 20 },
    { id: "second", x: 126, y: 149, width: 14, height: 20 },
    // The upper candidates start in the next 128-unit cell, just one unit away.
    { id: "obstacle", x: 95, y: 107, width: 50, height: 20 }
  ];
  const results = nodes.slice(0, 2).map(({ id }) => ({ id: "block:" + id, kind: "xor", category: "block",
    rootId: id, nodeIds: [id], boundaryIds: [] }));
  const view = { data: { blocks: { results }, reconvergence: { results: [] } } };
  const positions = (ordered) => {
    const { labels } = createStructurePresentation({ bounds: { width: 256, height: 256 }, nodes: ordered }, view);
    return [...labels.values()].map((label) => label.children[0].attributes);
  };
  const rects = positions(nodes);
  assert.equal(rects.length, 2);
  assert.deepEqual(positions([...nodes].reverse()), rects);
  const occupied = [...nodes];
  for (const box of rects) {
    for (const other of occupied) assert.ok(box.x >= other.x + other.width + 2 || other.x >= box.x + box.width + 2 ||
      box.y >= other.y + other.height + 2 || other.y >= box.y + box.height + 2, "label needs two units of clearance");
    occupied.push(box);
  }
});

test("structure panels escape source names, explain polarity, and expose partial coverage", () => {
  const imported = importAigSource(readFileSync(new URL("../fixtures/aig/structure_analysis.blif", import.meta.url), "utf8"), { name: "test.blif" });
  const data = analyzeAigStructure(imported.model), query = createStructureQuery(data);
  const source = structuredClone(imported);
  for (const node of source.model.nodes) node.label = '<img src=x onerror="bad()">';
  const workspace = { document: source, query: createAigQuery(source.model, source.analysis) };
  const selected = data.blocks.results.find((result) => result.kind === "mux");
  const inspector = renderAigStructureInspector(workspace, { query, selectedId: selected.id });
  assert.doesNotMatch(inspector, /<img/); assert.match(inspector, /&lt;img/);
  assert.match(inspector, /Input mapping at the positive root/);
  assert.match(inspector, /Root output uses \(1\)/);
  assert.match(inspector, /inverted edge<br><code>MUX2 · &quot;&lt;img/);
  const partial = { ...data, blocks: { ...data.blocks, status: "partial", reasons: ["cut-limit"] } };
  const navigator = renderAigStructureNavigator(workspace, { data: partial, query, category: "block", status: "partial" });
  assert.match(navigator, /Partial results/); assert.match(navigator, /cuts per node/); assert.doesNotMatch(navigator, /<img/);
  const many = { ...data, blocks: { ...data.blocks, results: Array.from({ length: 250 }, (_, i) => ({ ...selected, id: `block-${i}` })) } };
  const page = renderAigStructureNavigator(workspace, { data: many, query: createStructureQuery(many), category: "block", page: 1 });
  assert.equal((page.match(/data-aig-analysis-select=/g) || []).length, 100);
  assert.match(page, /data-aig-analysis-select="block-100"/); assert.doesNotMatch(page, /data-aig-analysis-select="block-200"/);
});

test("Inspector resolves each receiving port and gate input, keeping internal taps separate", () => {
  const source = importAigSource(`.model phases
.inputs a b s
.outputs direct neg internal gate posmux negmux
.names a b p
10 1
.names a b q
01 1
.names p q r
00 1
.names r direct
1 1
.names r neg
0 1
.names p internal
1 1
.names r s gate
01 1
.names s a p0
00 1
.names s b p1
10 1
.names p0 p1 m
00 1
.names m posmux
1 1
.names m negmux
0 1
.end`, { name: "phases.blif" });
  const data = analyzeAigStructure(source.model), query = createStructureQuery(data);
  const workspace = { document: source, query: createAigQuery(source.model, source.analysis) };
  const inspect = (kind) => {
    const blocks = query.list("block", kind);
    assert.equal(blocks.length, 1);
    return renderAigStructureInspector(workspace, { query, selectedId: blocks[0].id });
  };
  const parity = inspect("xnor");
  assert.match(parity, /Root output uses \(3\)/);
  assert.match(parity, />direct<\/button> · output port · positive edge<br><code>XNOR2 · ¬\(a ⊕ b\)<\/code>/);
  assert.match(parity, />neg<\/button> · output port · inverted edge<br><code>XOR2 · a ⊕ b<\/code>/);
  assert.match(parity, /input \d+ · inverted edge<br><code>XOR2 · a ⊕ b<\/code>/);
  assert.match(parity, /External uses of internal signals \(1\)/);
  assert.match(parity, />internal<\/button> · output port · positive edge<\/li>/);
  const mux = inspect("mux");
  assert.match(mux, / = s \? b : a<\/p>/);
  assert.match(mux, />posmux<\/button> · output port · positive edge<br><code>MUX2 · s \? b : a<\/code>/);
  assert.match(mux, />negmux<\/button> · output port · inverted edge<br><code>MUX2 · s \? ¬b : ¬a<\/code>/);
});

test("formula and pin mapping distinguish a signal name from an operator or node number", () => {
  const source = importAigSource(`.model literal_names
.inputs ¬b 7 bus[3]
.outputs y
.names bus[3] ¬b left
01 1
.names bus[3] 7 right
11 1
.names left right y
00 0
.end`, { name: "literal_names.blif" });
  const query = createStructureQuery(analyzeAigStructure(source.model));
  const workspace = { document: source, query: createAigQuery(source.model, source.analysis) };
  const [block] = query.list("block", "mux");
  const inspector = renderAigStructureInspector(workspace, { query, selectedId: block.id });
  assert.ok(inspector.includes(' = bus[3] ? ¬&quot;7&quot; : ¬&quot;¬b&quot;</p>'));
  assert.ok(inspector.includes('MUX2 · bus[3] ? &quot;7&quot; : &quot;¬b&quot;</code>'));
  assert.match(inspector, /D0<\/code> ¬<button[^>]+>&quot;¬b&quot;<\/button>/);
});

test("paging across root uses and internal taps visits every load once and reuses the tap index", () => {
  const ports = Array.from({ length: 101 }, (_, i) => [`r${i}`, `t${i}`]).flat();
  const source = importAigSource([
    ".model fanout", ".inputs a b", `.outputs ${ports.join(" ")}`, ".names a b p", "10 1",
    ".names a b q", "01 1", ".names p q root", "00 1",
    ...ports.flatMap((name) => [`.names ${name.startsWith("r") ? "root" : "p"} ${name}`, "1 1"]), ".end"
  ].join("\n"), { name: "fanout.blif" });
  const query = createStructureQuery(analyzeAigStructure(source.model));
  const [block] = query.list("block", "xnor");
  const outgoing = { ...source.analysis.outgoing };
  const tapId = block.nodeIds.find((id) => id !== block.rootId && outgoing[id].length > 100);
  let reads = 0;
  outgoing[tapId] = new Proxy(outgoing[tapId], { get(target, key, receiver) {
    if (typeof key === "string" && /^\d+$/.test(key)) reads++;
    return Reflect.get(target, key, receiver);
  } });
  const workspace = { document: { ...source, analysis: { ...source.analysis, outgoing } }, query: createAigQuery(source.model, source.analysis) };
  const page = (detailPage) => renderAigStructureInspector(workspace, { query, selectedId: block.id, detailPage });
  const first = page(0), second = page(1), firstPassReads = reads, third = page(2);
  assert.match(first, /Root output uses \(101\)/);
  assert.match(second, /Root output uses \(101\)/);
  assert.match(second, /External uses of internal signals \(101\)/);
  assert.doesNotMatch(third, /Root output uses/);
  const loads = [first, second, third].map((html) => [...html.matchAll(/>([rt]\d+)<\/button> · output port/g)].map((match) => match[1]));
  assert.deepEqual(loads.map((items) => items.length), [100, 100, 2]);
  assert.deepEqual(loads.flat().sort(), ports.sort());
  assert.equal(reads, firstPassReads, "flipping the page should reuse the internal tap index");
});
