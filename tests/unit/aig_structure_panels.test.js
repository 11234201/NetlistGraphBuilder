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
  assert.match(inspector, /Complement of canonical function/); assert.match(inspector, /Input mapping/);
  const partial = { ...data, blocks: { ...data.blocks, status: "partial", reasons: ["cut-limit"] } };
  const navigator = renderAigStructureNavigator(workspace, { data: partial, query, category: "block", status: "partial" });
  assert.match(navigator, /Partial results/); assert.match(navigator, /cuts per node/); assert.doesNotMatch(navigator, /<img/);
  const many = { ...data, blocks: { ...data.blocks, results: Array.from({ length: 250 }, (_, i) => ({ ...selected, id: `block-${i}` })) } };
  const page = renderAigStructureNavigator(workspace, { data: many, query: createStructureQuery(many), category: "block", page: 1 });
  assert.equal((page.match(/data-aig-analysis-select=/g) || []).length, 100);
  assert.match(page, /data-aig-analysis-select="block-100"/); assert.doesNotMatch(page, /data-aig-analysis-select="block-200"/);
});
