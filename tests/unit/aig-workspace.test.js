import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { instance } from "../../vendor/graphviz/viz.js";
import { createDefaultDomainRegistry } from "../../src/bootstrap/default_domains.js";
import { createWorkspaceServices } from "../../src/app/workspace_services.js";
import { createDomainWorkspace } from "../../src/application/domain_workspace.js";
import { aigFeature } from "../../src/domains/aig/aig_feature.js";
import { projectAigDot } from "../../src/domains/aig/aig_projection.js";
import { normalizeAigPresentation } from "../../src/domains/aig/aig_presentation.js";
import { createAigScene } from "../../src/domains/aig/aig_scene.js";
import { renderSvgScene } from "../../src/render/svg_scene_renderer.js";
import { encodeDomainWorkspace, decodeDomainWorkspace } from "../../src/persistence/domain_workspace_storage.js";

const fixture = (name) => readFileSync(new URL(`../fixtures/aig/${name}`, import.meta.url), "utf8");
const viz = await instance();
function setup(onCommit = () => {}) {
  const services = createWorkspaceServices();
  let calls = 0;
  const layout = { version: "test-real-viz", render: async (dot) => { calls++; return JSON.parse(viz.renderString(dot, { format: "json" })); } };
  const useCase = createDomainWorkspace({ documents: services.documents, sessions: services.viewSessions,
    jobs: services.workspaceJobs, registry: createDefaultDomainRegistry(), layout, onCommit });
  return { ...services, useCase, calls: () => calls };
}

test("paired real parsers, WASM, Scene and ArtifactStore preserve identical AIG geometry", async () => {
  const env = setup();
  const dot = await env.useCase.open("aig", { text: fixture("shared_cone.dot"), name: "input.dot", format: "abc-dot" });
  const blif = await env.useCase.open("aig", { text: fixture("shared_cone.blif"), name: "input.blif", format: "blif" });
  assert.equal(projectAigDot(dot.document.model.model), projectAigDot(blif.document.model.model));
  assert.deepEqual(dot.geometry, blif.geometry);
  assert.equal(renderSvgScene(dot.scene), renderSvgScene(blif.scene));
  assert.ok(blif.geometry.edges.some((edge) => edge.paths.some((path) => path.includes("C"))));
  assert.ok(env.workspaceArtifacts.list().every((artifact) => typeof artifact.value.scene.readNodes === "function"));
  assert.equal(env.documents.list().length, 1);
  assert.equal(env.viewSessions.list().length, 1);
});

test("analysis presentation and selection leave geometry, model and layout calls unchanged", async () => {
  const env = setup();
  const value = await env.useCase.open("aig", { text: fixture("shared_cone.blif"), name: "highlight.blif", format: "blif" });
  const modelBefore = JSON.stringify(value.document.model);
  const geometryBefore = JSON.stringify(value.geometry);
  const count = env.calls();
  const original = renderSvgScene(value.scene);
  const changed = renderSvgScene(createAigScene(value.document.model.model, value.document.model.analysis,
    value.geometry, { critical: false, fanout: true, fanoutThreshold: 3 }, value.geometry.edges[0].id));
  assert.notEqual(original, changed);
  assert.equal(JSON.stringify(value.document.model), modelBefore);
  assert.equal(JSON.stringify(value.geometry), geometryBefore);
  assert.equal(env.calls(), count);
  assert.equal((changed.match(/class="aig-edge-hit"/g) || []).length, value.geometry.edges.length);
});

test("AIG Scene preserves literal whitespace in names without depending on page CSS", async () => {
  const env = setup();
  const value = await env.useCase.open("aig", { text: fixture("whitespace_labels.dot"), name: "whitespace.dot", format: "abc-dot" });
  const names = new Map(value.document.model.model.nodes.map((node) => [node.id, node.label]));
  for (const node of value.scene.readNodes(0, value.scene.nodeCount)) {
    const labels = node.children.filter((child) => child.tag === "text");
    assert.equal(labels.length, 1);
    assert.equal(labels[0].children[0].value, names.get(node.attributes["data-aig-node"]));
    assert.equal(labels[0].attributes.style, "white-space:pre");
  }
  assert.match(renderSvgScene(value.scene), />a  b<\/text>/);
});

test("only enabled critical edge strokes are marked for retention during gestures", async () => {
  const { useCase } = setup();
  const workspace = await useCase.open("aig", { text: fixture("shared_cone.blif"), name: "gestures.blif" });
  const { model, analysis } = workspace.document.model;
  for (const critical of [false, true]) {
    const scene = createAigScene(model, analysis, workspace.geometry, { critical });
    const marked = scene.readEdges(0, scene.edgeCount).filter((edge) => edge.children.some((child) =>
      child.attributes?.class === "aig-edge-path" && child.attributes["data-aig-critical"] === ""));
    assert.deepEqual(new Set(marked.map((edge) => edge.attributes["data-aig-edge"])),
      new Set(critical ? analysis.criticalEdges : []));
  }
});

test("connection and selection halos preserve polarity while hit areas stay continuous", async () => {
  const { useCase } = setup();
  const workspace = await useCase.open("aig", { text: fixture("shared_cone.blif"), name: "polarity.blif" });
  const edges = workspace.scene.readEdges(0, workspace.scene.edgeCount);
  const polarities = new Set();
  for (const group of edges) {
    const inverted = workspace.query.edgeById.get(group.attributes["data-aig-edge"]).inverted;
    polarities.add(inverted);
    for (const cls of ["aig-edge-path", "aig-neighbor-halo", "aig-selection-halo", "aig-edge-hit"]) {
      const paths = group.children.filter((child) => child.attributes?.class === cls);
      assert.ok(paths.length);
      for (const path of paths) assert.equal(path.attributes["stroke-dasharray"] ?? null,
        inverted && cls !== "aig-edge-hit" ? "5 4" : null, cls);
    }
  }
  assert.equal(polarities.size, 2);
});

test("failed candidate and explicit cancellation retain the committed workspace", async () => {
  let commits = 0;
  const env = setup(() => { commits++; });
  const input = { text: fixture("duplicate_and.blif"), name: "duplicate.blif", format: "blif" };
  const first = await env.useCase.open("aig", input);
  await assert.rejects(env.useCase.open("aig", { ...input, text: ".model broken\n.gate LUT a=b\n.end" }));
  assert.equal(env.useCase.read(), first);
  const pending = env.useCase.open("aig", input);
  env.useCase.cancel();
  assert.equal(await pending, null);
  assert.equal(env.useCase.read(), first);
  assert.equal(commits, 1);
});

test("versioned domain archives preserve pure view data and reject incompatible schemas", () => {
  const archive = { domainId: "aig", source: { text: "source", name: "x.blif", format: "blif" },
    viewport: { x: 1, y: 2, scale: 1.5 }, selectedId: "n1", presentationPolicy: { critical: false }, panels: {} };
  const decoded = decodeDomainWorkspace(encodeDomainWorkspace(archive));
  for (const key of Object.keys(archive)) assert.deepEqual(decoded[key], archive[key]);
  assert.throws(() => decodeDomainWorkspace('{"version":88}'), /Unsupported/);
  assert.equal(aigFeature.capabilities.compare, false);
});

test("AIG styles reuse the source, preserve every object and cache a round trip", async () => {
  const env = setup();
  const first = await env.useCase.open("aig", { text: fixture("shared_cone.blif"), name: "views.blif" });
  const snapshot = JSON.stringify(first.document.model);
  assert.equal(env.viewSessions.require(first.sessionId).presentationPolicy.viewStyle, "abc");
  assert.equal(env.viewSessions.require(first.sessionId).presentationPolicy.connectionHighlight, "all");
  assert.equal(env.viewSessions.require(first.sessionId).presentationPolicy.critical, false);
  assert.equal(env.viewSessions.require(first.sessionId).presentationPolicy.fanout, false);
  const beforeCalls = env.calls();
  const standard = await env.useCase.relayout({ presentationPolicy: { viewStyle: "standard" } });
  assert.equal(standard.document, first.document);
  assert.equal(JSON.stringify(standard.document.model), snapshot);
  assert.deepEqual(standard.geometry.nodes.map((node) => node.id).sort(), first.geometry.nodes.map((node) => node.id).sort());
  assert.deepEqual(standard.geometry.edges.map((edge) => edge.id).sort(), first.geometry.edges.map((edge) => edge.id).sort());
  assert.notDeepEqual(standard.geometry, first.geometry);
  assert.equal(env.calls(), beforeCalls + 1);
  assert.match(renderSvgScene(standard.scene), /Arial/);
  assert.match(renderSvgScene(standard.scene), /stroke-dasharray="5 4"/);
  const appearance = (scene) => [...renderSvgScene(scene).matchAll(/(?:fill|stroke|stroke-width|stroke-dasharray|font-family|font-size)="[^"]*"/g)]
    .map((match) => match[0]).sort();
  assert.deepEqual(appearance(standard.scene), appearance(first.scene), "layout changes must preserve the complete visual style");
  const back = await env.useCase.relayout({ presentationPolicy: { viewStyle: "abc" } });
  assert.deepEqual(back.geometry, first.geometry);
  assert.equal(env.calls(), beforeCalls + 1, "returning to Logic View reuses cached geometry");
  assert.equal(env.documents.list().length, 1);
  assert.equal(env.viewSessions.list().length, 1);
  assert.equal(env.workspaceArtifacts.list().length, 1);
  env.useCase.leave();
  assert.equal(env.documents.list().length, 0);
  assert.equal(env.viewSessions.list().length, 0);
  assert.equal(env.workspaceArtifacts.list().length, 0);
});

test("both AIG layouts produce the same geometry under node and edge permutations", () => {
  const document = aigFeature.importSource({ text: fixture("shared_cone.blif"), name: "stable.blif" });
  const model = document.model.model;
  const reversed = { ...model, nodes: [...model.nodes].reverse(), edges: [...model.edges].reverse() };
  for (const viewStyle of ["abc", "standard"]) {
    const canonical = projectAigDot(model, { viewStyle });
    const permuted = projectAigDot(reversed, { viewStyle });
    assert.deepEqual(viz.renderJSON(permuted), viz.renderJSON(canonical), viewStyle);
    assert.equal(permuted, canonical, viewStyle);
  }
  const original = projectAigDot(model, { viewStyle: "abc" });
  for (const missing of [undefined, null, {}, { viewStyle: "unknown" }]) {
    assert.equal(projectAigDot(model, missing), original);
    assert.equal(normalizeAigPresentation(missing).viewStyle, "abc");
  }
});

test("repeated SVG exports reuse the model indexes across selections and depths", async () => {
  const { useCase } = setup();
  const workspace = await useCase.open("aig", { text: fixture("shared_cone.blif"), name: "exports.blif" });
  const { model, analysis } = workspace.document.model;
  let reads = 0;
  const counted = { ...model, get nodes() { reads++; return model.nodes; }, get edges() { reads++; return model.edges; } };
  const [and, port] = ["and", "po"].map((kind) => model.nodes.find((node) => node.kind === kind));
  const svg = (selected, depth) => renderSvgScene(createAigScene(counted, analysis, workspace.geometry,
    { connectionHighlight: depth }, selected.id));
  assert.match(svg(and, 1), /data-neighbor-role="output"/);
  const initialReads = reads;
  assert.match(svg(port, 2), /data-neighbor-role="input"/);
  assert.equal(reads, initialReads, "a new export does not rebuild the node and edge indexes");
  useCase.leave();
});

test("analysis highlighting defaults off and explicit saved choices survive normalization", () => {
  for (const input of [undefined, null, {}, { critical: false, fanout: false }]) {
    const policy = normalizeAigPresentation(input);
    assert.equal(policy.critical, false);
    assert.equal(policy.fanout, false);
    assert.equal(policy.connectionHighlight, "all");
  }
  assert.equal(normalizeAigPresentation({ neighbors: false }).connectionHighlight, "off");
  assert.equal(normalizeAigPresentation({ neighbors: true }).connectionHighlight, "all");
  assert.equal(normalizeAigPresentation({ neighbors: false, connectionHighlight: 3 }).connectionHighlight, 3);
  for (const value of ["", null, 0, -1, 1.5, true, "oops", Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(normalizeAigPresentation({ connectionHighlight: value }).connectionHighlight, "all");
  }
  const policy = normalizeAigPresentation({ critical: true, fanout: true, viewStyle: "standard", connectionHighlight: "2" });
  assert.equal(policy.connectionHighlight, 2);
  const archive = { domainId: "aig", source: { text: "source", name: "x.blif", format: "blif" }, presentationPolicy: policy };
  assert.deepEqual(normalizeAigPresentation(decodeDomainWorkspace(encodeDomainWorkspace(archive)).presentationPolicy), policy);
});

test("Logic View places shallow outputs beside their drivers instead of on a global output row", async () => {
  const env = setup();
  const text = `.model output_depths
.inputs a b c d
.outputs direct shallow deep zero
.names a direct
0 1
.names a b shallow
11 1
.names shallow c middle
11 1
.names middle d deep
11 1
.names zero
.end`;
  const logic = await env.useCase.open("aig", { text, name: "depths.blif" });
  const standard = await env.useCase.relayout({ presentationPolicy: { viewStyle: "standard" } });
  const model = logic.document.model.model;
  const outputs = model.nodes.filter((node) => node.kind === "po");
  const standardNodes = new Map(standard.geometry.nodes.map((node) => [node.id, node]));
  const logicNodes = new Map(logic.geometry.nodes.map((node) => [node.id, node]));
  assert.equal(new Set(outputs.map((node) => standardNodes.get(node.id).center.y)).size, 1);
  assert.ok(new Set(outputs.map((node) => logicNodes.get(node.id).center.y)).size > 1);
  const shallow = outputs.find((node) => node.label === "shallow");
  const edge = model.edges.find((edge) => edge.target === shallow.id);
  const span = (nodes) => nodes.get(edge.source).center.y - nodes.get(edge.target).center.y;
  assert.ok(span(logicNodes) < span(standardNodes), "shallow output stays nearer its own driver");
  for (const edge of model.edges) assert.ok(logicNodes.get(edge.source).center.y > logicNodes.get(edge.target).center.y);
  assert.deepEqual(new Set(logicNodes.keys()), new Set(standardNodes.keys()));
  assert.equal(logic.geometry.edges.length, model.edges.length);
});
