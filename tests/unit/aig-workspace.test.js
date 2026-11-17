import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { instance } from "../../vendor/graphviz/viz.js";
import { createDefaultDomainRegistry } from "../../src/bootstrap/default_domains.js";
import { createWorkspaceServices } from "../../src/app/workspace_services.js";
import { createDomainWorkspace } from "../../src/application/domain_workspace.js";
import { aigFeature } from "../../src/domains/aig/aig_feature.js";
import { projectAigDot } from "../../src/domains/aig/aig_projection.js";
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
  assert.equal(env.viewSessions.require(first.sessionId).presentationPolicy.viewStyle, "standard");
  assert.equal(env.viewSessions.require(first.sessionId).presentationPolicy.neighbors, true);
  const beforeCalls = env.calls();
  const abc = await env.useCase.relayout({ presentationPolicy: { viewStyle: "abc" } });
  assert.equal(abc.document, first.document);
  assert.equal(JSON.stringify(abc.document.model), snapshot);
  assert.deepEqual(abc.geometry.nodes.map((node) => node.id).sort(), first.geometry.nodes.map((node) => node.id).sort());
  assert.deepEqual(abc.geometry.edges.map((edge) => edge.id).sort(), first.geometry.edges.map((edge) => edge.id).sort());
  assert.notDeepEqual(abc.geometry, first.geometry);
  assert.equal(env.calls(), beforeCalls + 1);
  assert.match(renderSvgScene(abc.scene), /Arial/);
  assert.match(renderSvgScene(abc.scene), /stroke-dasharray="5 4"/);
  const appearance = (scene) => [...renderSvgScene(scene).matchAll(/(?:fill|stroke|stroke-width|stroke-dasharray|font-family|font-size)="[^"]*"/g)]
    .map((match) => match[0]).sort();
  assert.deepEqual(appearance(abc.scene), appearance(first.scene), "layout changes must preserve the complete visual style");
  const back = await env.useCase.relayout({ presentationPolicy: { viewStyle: "standard" } });
  assert.deepEqual(back.geometry, first.geometry);
  assert.equal(env.calls(), beforeCalls + 1, "returning to Standard reuses cached geometry");
  assert.equal(env.documents.list().length, 1);
  assert.equal(env.viewSessions.list().length, 1);
  assert.equal(env.workspaceArtifacts.list().length, 1);
  env.useCase.leave();
  assert.equal(env.documents.list().length, 0);
  assert.equal(env.viewSessions.list().length, 0);
  assert.equal(env.workspaceArtifacts.list().length, 0);
});

test("ABC projection and real geometry are invariant under node and edge permutations", () => {
  const document = aigFeature.importSource({ text: fixture("shared_cone.blif"), name: "stable.blif" });
  const model = document.model.model;
  const policy = { viewStyle: "abc" };
  const original = projectAigDot(model, policy);
  const reversed = projectAigDot({ ...model, nodes: [...model.nodes].reverse(), edges: [...model.edges].reverse() }, policy);
  assert.equal(reversed, original);
  assert.deepEqual(viz.renderJSON(reversed), viz.renderJSON(original));
  assert.equal(projectAigDot(model), projectAigDot(model, { viewStyle: "standard", neighbors: false }));
});
