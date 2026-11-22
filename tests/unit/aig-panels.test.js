import test from "node:test";
import assert from "node:assert/strict";
import { renderAigNavigator, renderAigInspector, revealAigNavigatorSelection, AIG_PANEL_PAGE_SIZE } from "../../src/ui/aig_panels.js";
import { importAigSource } from "../../src/domains/aig/aig_import.js";
import { createAigQuery } from "../../src/domains/aig/aig_query.js";
import { analyzeAigStructure } from "../../src/domains/aig/structure_analysis.js";
import { createStructureQuery } from "../../src/domains/aig/structure_query.js";

function createWorkspace(extraNodes = 0) {
  const nodes = [
    { id: "pi:0", kind: "pi", label: 'input<&"雪', level: 0, sourceRefs: [{ id: 'source"<pi>', label: 'input<&"雪', line: 2, column: 3, inverted: false }] },
    { id: "and:0", kind: "and", label: "1", level: 1, sourceRefs: [{ id: "n1", label: "shared", line: 4, inverted: false }, { id: "n2", label: "negative", line: 5, inverted: true }] },
    { id: "po:0", kind: "po", label: "output", level: 1, sourceRefs: [] },
    ...Array.from({ length: extraNodes }, (_, index) => ({ id: `extra:${index}`, kind: "po", label: `output_${String(index).padStart(4, "0")}`, level: 1, sourceRefs: [] }))
  ];
  const edges = [
    { id: "edge:0", source: "pi:0", target: "and:0", slot: 0, inverted: false, sourceRefs: [] },
    { id: "edge:1", source: "pi:0", target: "and:0", slot: 1, inverted: true, sourceRefs: [] },
    { id: "edge:2", source: "and:0", target: "po:0", slot: 0, inverted: false, sourceRefs: [] },
    ...Array.from({ length: extraNodes }, (_, index) => ({ id: `fanout:${index}`, source: "and:0", target: `extra:${index}`, slot: 0, inverted: false, sourceRefs: [] }))
  ];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]));
  const incoming = {}, outgoing = {}, fanout = {};
  for (const node of nodes) { incoming[node.id] = []; outgoing[node.id] = []; fanout[node.id] = 0; }
  for (const edge of edges) { incoming[edge.target].push(edge.id); outgoing[edge.source].push(edge.id); fanout[edge.source] += 1; }
  const analysis = { depth: 1, counts: { pi: 1, and: 1, po: extraNodes + 1, constant: 0, edges: edges.length, invertedEdges: 1 }, fanout, incoming, outgoing,
    criticalNodes: ["pi:0", "and:0", "po:0"], criticalEdges: ["edge:0", "edge:2"] };
  let searches = 0;
  return {
    document: { model: { nodes, edges }, analysis, format: "blif", name: 'test<".blif', source: "source text" },
    query: { nodeById, edgeById, criticalNodes: new Set(analysis.criticalNodes), criticalEdges: new Set(analysis.criticalEdges), getObject(id) { return nodeById.get(id) || edgeById.get(id); } },
    search(text, limit) { searches += 1; return nodes.filter((node) => `${node.label} ${node.sourceRefs.map((ref) => ref.id).join(" ")}`.includes(text)).slice(0, limit); },
    get searches() { return searches; }
  };
}

test("AIG navigator escapes source names and defaults to bounded PI/PO browsing", () => {
  const workspace = createWorkspace(130);
  const design = renderAigNavigator(workspace);
  assert.match(design, /test&lt;&quot;\.blif/);
  assert.match(design, /Maximum AND depth/);
  assert.match(design, /Fanout ≥ 2/);
  const objects = renderAigNavigator(workspace, { tab: "objects" });
  assert.equal((objects.match(/data-aig-select=/g) || []).length, AIG_PANEL_PAGE_SIZE);
  assert.match(objects, /input&lt;&amp;&quot;雪/);
  assert.doesNotMatch(objects, /data-aig-select="and:0"/);
  assert.match(objects, /Page 1 \/ 2/);
  const pathNav = renderAigNavigator(workspace, { tab: "path" });
  assert.match(pathNav, /data-aig-nav-tab="path"[^>]*aria-selected="true"/);
  assert.doesNotMatch(pathNav, /data-aig-nav-content=/);
  const next = renderAigNavigator(workspace, { tab: "objects", page: 1 });
  assert.equal((next.match(/data-aig-select=/g) || []).length, 32);
  assert.equal(workspace.searches, 1, "pagination reuses the query result");
});

test("AIG navigator filters with analysis indexes and retains an excluded selection", () => {
  const workspace = createWorkspace();
  const options = { tab: "objects", type: "all", analysisFilter: "fanout", fanoutThreshold: 2, sort: "fanout" };
  const first = renderAigNavigator(workspace, options);
  assert.match(first, /data-aig-select="pi:0"/);
  assert.doesNotMatch(first, /data-aig-select="and:0"/);
  const selected = renderAigNavigator(workspace, { ...options, selectedId: "and:0" });
  assert.match(selected, /Current selection is outside the filter/);
  assert.match(selected, /data-aig-show-selection="and:0"/);
  assert.equal(workspace.searches, 1, "selection does not rerun search/filter/sort");
  const source = renderAigNavigator(workspace, { tab: "objects", type: "all", query: "n2" });
  assert.match(source, /data-aig-select="and:0"/);
});

test("AIG object and edge panels use topology levels for designs with input offsets", () => {
  const imported = importAigSource(".model gates\n.inputs a b\n.outputs y\n.names a b y\n11 1\n.end", {
    name:"gates.blif", levelFile:{name:"gates.level", text:"a 3"}
  });
  const query = createAigQuery(imported.model, imported.analysis);
  const workspace = {document:imported, query, search:() => imported.model.nodes};
  const objects = renderAigNavigator(workspace, {tab:"objects", sort:"depth"});
  assert.match(objects, /topology level 3 · fanout/);
  assert.match(objects, /Topology level \(highest first\)/);
  const input = imported.model.nodes.find(node => node.kind === "pi" && node.label === "a");
  const edge = imported.model.edges.find(candidate => candidate.source === input.id);
  const analysis = renderAigInspector(workspace, {selectedId:edge.id, tab:"analysis"});
  assert.match(analysis, /Source topology level<\/dt><dd><code>3/);
  assert.match(analysis, /Target topology level<\/dt><dd><code>4/);
});

test("AIG navigator exposes a selected object on another page without changing the requested page", () => {
  const workspace = createWorkspace(230);
  const options = { tab: "objects", type: "po", query: "output_", sort: "name", page: 0, selectedId: "extra:229" };
  const html = renderAigNavigator(workspace, options);
  assert.match(html, /Current selection is on another page/);
  assert.match(html, /data-aig-show-selection="extra:229"/);
  assert.match(html, /Page 1 \/ 3/);
  assert.doesNotMatch(html, /data-aig-select="extra:229"/);
});

test("revealing an off-page selection preserves filters and sort and reuses cached positions", () => {
  const workspace = createWorkspace(230);
  const options = Object.freeze({ tab: "objects", type: "po", query: "output_", analysisFilter: "all", sort: "fanout", page: 0 });
  renderAigNavigator(workspace, { ...options, selectedId: "extra:229" });
  const revealed = revealAigNavigatorSelection(workspace, options, "extra:229");
  assert.deepEqual(revealed, { ...options, page: 2 });
  const html = renderAigNavigator(workspace, { ...revealed, selectedId: "extra:229" });
  assert.match(html, /data-aig-select="extra:229"[^>]*aria-current="true"/);
  assert.doesNotMatch(html, /data-aig-show-selection/);
  assert.equal(workspace.searches, 1, "finding the selection page reuses the filtered/sorted index");
});

test("revealing a filtered-out selection clears excluding filters and opens its actual page", () => {
  const workspace = createWorkspace(230);
  const options = Object.freeze({ tab: "objects", type: "pi", query: "input", analysisFilter: "fanout", sort: "name", page: 0 });
  const filtered = renderAigNavigator(workspace, { ...options, selectedId: "extra:229" });
  assert.match(filtered, /Current selection is outside the filter/);
  const revealed = revealAigNavigatorSelection(workspace, options, "extra:229");
  assert.deepEqual(revealed, { ...options, type: "all", query: "", analysisFilter: "all", page: 2 });
  const html = renderAigNavigator(workspace, { ...revealed, selectedId: "extra:229" });
  assert.match(html, /data-aig-select="extra:229"[^>]*aria-current="true"/);
  assert.doesNotMatch(html, /data-aig-show-selection/);
  assert.equal(workspace.searches, 2, "only clearing the filters builds a new result index");
});

test("revealing selection uses the active fanout threshold without storing it in panel filters", () => {
  const workspace = createWorkspace();
  const options = { tab: "objects", type: "all", query: "", analysisFilter: "fanout", sort: "name", page: 0 };
  const html = renderAigNavigator(workspace, { ...options, selectedId: "pi:0", fanoutThreshold: 3 });
  assert.match(html, /Current selection is outside the filter/);
  assert.deepEqual(revealAigNavigatorSelection(workspace, options, "pi:0", 3), { ...options, analysisFilter: "all" });
});

test("AIG inspector preserves each duplicate slot and independent polarity/critical state", () => {
  const workspace = createWorkspace();
  const html = renderAigInspector(workspace, { selectedId: "and:0" });
  assert.match(html, /data-aig-select="edge:0">Slot 0/);
  assert.match(html, /data-aig-select="edge:1">Slot 1/);
  assert.match(html, /Inverted<\/td><td>—/);
  assert.match(html, /Positive<\/td><td>Critical/);
  assert.match(html, /data-aig-select="edge:2"/);
  const edge = renderAigInspector(workspace, { selectedId: "edge:1" });
  assert.match(edge, /data-aig-inspected-id="edge:1"/);
  assert.match(edge, /Inverted \(dashed\)/);
  assert.match(edge, /Logical critical path<\/dt><dd><code>No/);
  assert.match(edge, /data-aig-select="pi:0"/);
  assert.match(edge, /data-aig-select="and:0"/);
});

test("AIG inspector renders bounded connections, full source aliases, analysis and missing selection", () => {
  const workspace = createWorkspace(220);
  const first = renderAigInspector(workspace, { selectedId: "and:0" });
  assert.equal((first.match(/<tr>/g) || []).length, AIG_PANEL_PAGE_SIZE + 1);
  const last = renderAigInspector(workspace, { selectedId: "and:0", page: 2 });
  assert.equal((last.match(/<tr>/g) || []).length, 24);
  const source = renderAigInspector(workspace, { selectedId: "and:0", tab: "source" });
  assert.match(source, /shared/);
  assert.match(source, /negative/);
  assert.match(source, /line 5/);
  assert.match(source, /Alias polarity<\/dt><dd><code>Inverted/);
  const escaped = renderAigInspector(workspace, { selectedId: "pi:0", tab: "source" });
  assert.match(escaped, /data-aig-copy="input&lt;&amp;&quot;雪"/);
  assert.doesNotMatch(escaped, /<pi>/);
  const analysis = renderAigInspector(workspace, { selectedId: "and:0", tab: "analysis", fanoutThreshold: 222 });
  assert.doesNotMatch(analysis, /not cell timing|PO reference/);
  assert.match(analysis, /Fanout references<\/dt><dd><code>221/);
  assert.match(analysis, /Threshold reached<\/dt><dd><code>No/);
  const empty = renderAigInspector(workspace, { selectedId: "missing" });
  assert.match(empty, /Select an object/);
  assert.doesNotMatch(empty, /data-aig-inspected-id/);
});

test("AIG edge source details distinguish original literal polarity from alias-normalized polarity", () => {
  const imported = importAigSource(`.model alias_polarity
.inputs a c
.outputs y
.names a b
0 1
.names b c y
01 1
.end`, { format: "blif", name: "alias.blif" });
  const { model, analysis } = imported;
  const workspace = { document: imported, query: createAigQuery(model, analysis) };
  const edge = model.edges.find((candidate) => candidate.sourceRefs.some((ref) => ref.id === "b"));
  assert.equal(edge.inverted, false, "inverting the inverted alias b produces a positive normalized edge");
  const source = renderAigInspector(workspace, { selectedId: edge.id, tab: "source" });
  assert.match(source, /Source ID<\/dt><dd><code>b/);
  assert.match(source, /Target source ID<\/dt><dd><code>y/);
  assert.match(source, /Source input slot<\/dt><dd><code>0/);
  assert.match(source, /Source edge polarity<\/dt><dd><code>Inverted/);
  assert.match(source, /Normalized edge polarity<\/dt><dd><code>Positive/);
  assert.doesNotMatch(source, /Alias polarity/);
  const nodeSource = renderAigInspector(workspace, { selectedId: edge.source, tab: "source" });
  assert.match(nodeSource, /Alias polarity<\/dt><dd><code>Inverted/);
  assert.doesNotMatch(nodeSource, /Source edge polarity/);
});

test("BLIF Names navigation paginates, filters, escapes design names and retains outside-Focused mappings", () => {
  const signals = Array.from({ length: 120 }, (_, index) => `n${index}`);
  const comments = signals.map((id) => `# ${id} top/cell[${id}]<&"`);
  const imported = importAigSource(comments.concat([".model mapped", ".inputs " + signals.join(" "),
    ".outputs n0", ".end"]).join("\n"), { format: "blif" });
  const { model, analysis } = imported;
  const workspace = { document: imported, query: createAigQuery(model, analysis), visibleNodeIds: new Set() };
  const options = { tab: "names" };
  const first = renderAigNavigator(workspace, options);
  assert.equal((first.match(/data-aig-select=/g) || []).length, AIG_PANEL_PAGE_SIZE);
  assert.match(first, /Page 1 \/ 2/);
  assert.match(first, /121 mappings/);
  assert.match(first, /outside Focused/);
  const last = renderAigNavigator(workspace, { ...options, page: 1 });
  assert.equal((last.match(/data-aig-select=/g) || []).length, 21);
  const filtered = renderAigNavigator(workspace, { ...options, nameQuery: "CELL[N0]" });
  assert.match(filtered, /2 mappings/);
  assert.match(filtered, /data-aig-copy="top\/cell\[n0\]&lt;&amp;&quot;"/);
  assert.match(filtered, /Output port/);
  const driver = model.nameMappings.find((row) => row.signalId === "n0" && row.usage === "driver");
  const details = renderAigInspector(workspace, { selectedId: driver.nodeId, tab: "source" });
  assert.match(details, /Mapped names/);
  assert.match(details, /n0 → top\/cell\[n0\]&lt;&amp;&quot;/);
});

test("Inspector distinguishes the defining signal from an earlier inverse alias in the mapping summary", () => {
  const document = importAigSource(["# a first_alias", "# z primary_input", ".model names",
    ".inputs z", ".outputs a", ".names z a", "0 1", ".end"].join("\n"), { format: "blif" });
  const query = createAigQuery(document.model, document.analysis);
  const pi = document.model.nodes.find((node) => node.kind === "pi");
  const html = renderAigInspector({ document, query }, { selectedId: pi.id, tab: "source" });
  assert.match(html, /Mapped name<\/dt><dd><code>primary_input/);
  assert.match(html, /BLIF signal<\/dt><dd><code>z/);
  assert.match(html, /Mapping polarity<\/dt><dd><code>Positive/);
  assert.match(html, /a → first_alias.*?Inverted/);
});

test("block formulas and input mappings distinguish different PI signals with the same BLIF design name", () => {
  const document = importAigSource(["# p shared", "# q shared", ".model names", ".inputs p q", ".outputs y",
    ".names p q y", "01 1", "10 1", ".end"].join("\n"), { format: "blif" });
  const result = analyzeAigStructure(document.model);
  const block = result.blocks.results[0];
  const workspace = { document, query: createAigQuery(document.model, document.analysis) };
  const html = renderAigInspector(workspace, { structure: { query: createStructureQuery(result), selectedId: block.id } });
  const [first, second] = block.inputIds;
  assert.ok(html.includes(`${block.rootId} = ${first} ⊕ ${second}`));
  for (const id of block.inputIds) assert.ok(html.includes(`${id} · shared`));
});
