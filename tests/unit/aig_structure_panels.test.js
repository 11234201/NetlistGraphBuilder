import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { importAigSource } from "../../src/domains/aig/aig_import.js";
import { createAigQuery } from "../../src/domains/aig/aig_query.js";
import { analyzeAigStructure } from "../../src/domains/aig/structure_analysis.js";
import { createStructureQuery } from "../../src/domains/aig/structure_query.js";
import { renderAigStructureNavigator, renderAigStructureInspector } from "../../src/ui/aig_structure_panels.js";

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
