import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createDomainRegistry } from "../../src/bootstrap/domain_registry.js";
import { createDocumentStore } from "../../src/application/document_store.js";
import { createViewSessionStore } from "../../src/application/view_session_store.js";
import { createCommandBus } from "../../src/application/command_bus.js";
import { createViewCommandHandlers } from "../../src/application/view_commands.js";
import { runViewPipeline } from "../../src/application/view_pipeline.js";
import { measureDiagramGraph } from "../../src/diagram/measure_graph.js";
import { layoutGraph } from "../../src/layout/simpleLayered.js";
import { renderSvgScene } from "../../src/render/svg_scene_renderer.js";
import { createMemoryAigModel, createMemoryAigScene, memoryAigFeature } from "../support/memory_aig_feature.js";
import { netlistFeature } from "../../src/domains/netlist/netlist_feature.js";

test("independent memory AIG runs through shared document, command, pipeline, layout, scene and SVG boundaries", () => {
  const registry = createDomainRegistry([memoryAigFeature]);
  const feature = registry.require("memory-aig");
  const documents = createDocumentStore();
  const document = documents.open(feature.importSource({ model: createMemoryAigModel() }));
  const sessions = createViewSessionStore();
  sessions.create({ sessionId: "aig-view", documentId: document.documentId, domainId: feature.id, unitId: "top" });
  const commandBus = createCommandBus(createViewCommandHandlers({ sessions }));
  const andRef = feature.search(feature.buildSearchIndex(document), "and0", 1)[0].objectRef;
  const commandResult = commandBus.dispatch({ type: "focus.add", sessionId: "aig-view", objectRef: andRef });
  const query = commandResult.session;

  const result = runViewPipeline({
    query: () => feature.queryView(document, { unitId: query.unitId, mode: query.viewMode, rootNodeIds: query.focusedRootRefs.map((item) => item.localId) }),
    project: (value) => feature.projectDiagram(value),
    measure: (diagram) => measureDiagramGraph(diagram),
    layout: (measured) => layoutGraph(measured),
    applyOverrides: (graph) => graph,
    createScene: createMemoryAigScene
  }, {});
  const svg = renderSvgScene(result.scene);

  assert.equal(result.diagram.domainId, "memory-aig");
  assert.ok(result.graph.nodes.some((item) => item.id === "and0"));
  assert.equal(document.model.sourceMap.and0.record, 4);
  assert.equal(result.diagram.projectionMap.get("and0").localId, "and0");
  assert.equal(result.scene.objectRefs.get("and0").localId, "and0");
  assert.deepEqual(result.diagram.edges.filter((item) => item.source === "and0" && item.target === "and1").map((item) => item.targetPin), ["in0", "in1"]);
  assert.equal(result.diagram.edges.find((item) => item.id === "e1").inverted, true);
  assert.match(svg, /aig-and/);
  assert.match(svg, /aig-inversion/);
  assert.equal(feature.capabilities.timing, false);
  assert.equal(feature.capabilities.cellConfig, false);
});

test("memory AIG preserves duplicate fanin slots, shared subgraphs, constants and latch boundaries", () => {
  const model = createMemoryAigModel().units[0];
  const duplicate = model.edges.filter((item) => item.source === "and0" && item.target === "and1");

  assert.deepEqual(duplicate.map((item) => item.slot), [0, 1]);
  assert.ok(model.nodes.some((item) => item.kind === "constant"));
  assert.ok(model.nodes.some((item) => item.kind === "latch"));
  assert.ok(model.edges.some((item) => item.inverted));
});

test("Netlist and AIG documents and focused commands remain isolated", () => {
  const documents = createDocumentStore();
  const aigDocument = documents.open(memoryAigFeature.importSource({ model: createMemoryAigModel() }));
  const netlistDocument = documents.open(netlistFeature.importSource({
    name: "tiny.v",
    text: "module tiny(input a, output y); BUF u0 (.A(a), .Z(y)); endmodule"
  }, { documentId: "netlist:tiny" }));
  const sessions = createViewSessionStore([
    { sessionId: "aig", documentId: aigDocument.documentId, domainId: memoryAigFeature.id, unitId: "top" },
    { sessionId: "netlist", documentId: netlistDocument.documentId, domainId: netlistFeature.id, unitId: "tiny" }
  ]);
  const bus = createCommandBus(createViewCommandHandlers({ sessions }));
  const aigRef = memoryAigFeature.search(memoryAigFeature.buildSearchIndex(aigDocument), "and0", 1)[0].objectRef;
  const netlistRef = netlistFeature.search(netlistFeature.buildSearchIndex(netlistDocument), "u0", 1)[0].objectRef;

  bus.dispatch({ type: "focus.add", sessionId: "aig", objectRef: aigRef });
  bus.dispatch({ type: "focus.add", sessionId: "netlist", objectRef: netlistRef });
  assert.equal(sessions.require("aig").focusedRootRefs[0].localId, "and0");
  assert.equal(sessions.require("netlist").focusedRootRefs[0].localId, "u0");
  assert.throws(() => bus.dispatch({ type: "focus.add", sessionId: "aig", objectRef: netlistRef }), /another document/);
});

test("shared runtime contains no memory AIG special case", async () => {
  const sharedFiles = [
    "../../src/application/view_pipeline.js",
    "../../src/application/view_commands.js",
    "../../src/layout/simpleLayered.js",
    "../../src/render/svg_scene_renderer.js"
  ];
  for (const relativePath of sharedFiles) {
    const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
    assert.doesNotMatch(source, /memory-aig|aig-inversion|aig-and/i);
  }
});
