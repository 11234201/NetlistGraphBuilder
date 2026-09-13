import assert from "node:assert/strict";
import test from "node:test";
import { createDomainRegistry } from "../../src/bootstrap/domain_registry.js";
import { createDefaultDomainRegistry } from "../../src/bootstrap/default_domains.js";
import { createDiagramGraph, createMeasuredGraph, createScene } from "../../src/contracts/diagram.js";
import { createDiagnostic } from "../../src/contracts/diagnostic.js";
import { createImmediateExecutor } from "../../src/contracts/executor.js";
import { createViewQuery } from "../../src/contracts/view_query.js";
import { createDocumentEnvelope, normalizeSourceInput } from "../../src/contracts/document.js";
import { defineDomainFeature } from "../../src/contracts/domain_feature.js";
import { createObjectRef, isObjectRef, objectRefKey } from "../../src/contracts/object_ref.js";

test("document and object identities validate without deriving identity from labels", () => {
  const ref = createObjectRef({ documentId: "doc:1", unitId: "top", kind: "cell", localId: "\\u[0] " });
  assert.equal(isObjectRef(ref), true);
  assert.match(objectRefKey(ref), /%5Cu%5B0%5D%20/);
  assert.throws(() => createObjectRef({ documentId: "doc:1", unitId: "top", kind: "cell" }), /localId/);
  const model = {};
  const document = createDocumentEnvelope({ documentId: "doc:1", domainId: "test", model });
  assert.equal(document.model, model);
  assert.equal(document.sourceRevision, 1);
  assert.equal(Object.isFrozen(document), true);
  assert.equal(normalizeSourceInput({ name: "x.aig", bytes: new Uint8Array([1]) }).kind, "bytes");
});

test("object references preserve optional hierarchical occurrence identity", () => {
  const ref = createObjectRef({
    documentId: "doc:1",
    unitId: "leaf",
    kind: "net",
    localId: "out",
    occurrencePath: ["u_left", "u_leaf"]
  });
  assert.deepEqual(ref.occurrencePath, ["u_left", "u_leaf"]);
  assert.notEqual(
    objectRefKey(ref),
    objectRefKey({ documentId: "doc:1", unitId: "leaf", kind: "net", localId: "out" })
  );
  assert.throws(() => createObjectRef({
    documentId: "doc:1", unitId: "leaf", kind: "net", localId: "out", occurrencePath: "u_left"
  }), /occurrencePath/);
});

test("view, diagnostic, and executor ports reject malformed boundary values", async () => {
  const query = createViewQuery({ unitId: "top", mode: "focused", rootNodeIds: ["cell:u1"] });
  const diagnostic = createDiagnostic({ severity: "warning", code: "W1", message: "example" });
  const result = await createImmediateExecutor().execute(() => 42);
  assert.equal(query.rootNodeIds[0], "cell:u1");
  assert.equal(diagnostic.code, "W1");
  assert.equal(result, 42);
  assert.throws(() => createViewQuery({ unitId: "top", mode: "unknown" }), /Unsupported/);
  assert.throws(() => createViewQuery({ unitId: "top", rootNodeIds: "cell:u1" }), /must be an array/);
  assert.throws(() => createViewQuery({ unitId: "top", rootNodeIds: [""] }), /non-empty strings/);
  assert.throws(() => createDiagnostic({ severity: "fatal", code: "X", message: "x" }), /severity/);
});

test("diagram contracts keep semantic, measured, and scene stages separate", () => {
  const diagram = createDiagramGraph({
    id: "diagram:1",
    domainId: "test",
    unitId: "top",
    nodes: [{ id: "n1", ports: [{ id: "p1", direction: "out" }] }],
    edges: [{ id: "e1", source: { nodeId: "n1", portId: "p1" }, target: { nodeId: "n2" } }]
  });
  const measured = createMeasuredGraph(diagram, { nodes: new Map([["n1", { width: 10, height: 8 }]]) });
  const scene = createScene({ diagramId: diagram.id, nodes: [{ id: "n1", x: 0, y: 0 }], bounds: { width: 10, height: 8 } });
  assert.equal(measured.diagram, diagram);
  assert.equal(scene.diagramId, diagram.id);
  assert.equal(Object.isFrozen(diagram.nodes[0].ports), true);
  assert.throws(() => createDiagramGraph({ id: "d", domainId: "x", unitId: "u", nodes: [{ id: "n" }, { id: "n" }] }), /Duplicate/);
});

test("domain features and registry reject incomplete or duplicate registrations", () => {
  assert.throws(() => defineDomainFeature({ id: "bad" }), /importSource/);
  const methods = Object.fromEntries([
    "importSource", "listUnits", "buildSearchIndex", "search", "queryView", "projectDiagram"
  ].map((name) => [name, () => null]));
  const feature = defineDomainFeature({
    id: "test",
    ...methods,
    capabilities: { timing: true },
    commands: [{ id: "focus.add" }],
    panels: [{ id: "details" }],
    layoutProfiles: [{ id: "compact" }]
  });
  const registry = createDomainRegistry([feature]);
  assert.equal(registry.require("test").id, feature.id);
  assert.deepEqual(registry.list(), [feature]);
  assert.equal(registry.hasCapability("test", "timing"), true);
  assert.equal(registry.hasCapability("test", "cellConfig"), false);
  assert.deepEqual(registry.contributions("test", "commands"), [{ id: "focus.add" }]);
  assert.deepEqual(registry.contributions("missing", "panels"), []);
  assert.throws(() => createDomainRegistry([feature, feature]), /Duplicate/);
  assert.throws(() => createDomainRegistry([{ id: "incomplete" }]), /requires importSource/);
  assert.throws(() => defineDomainFeature({ id: "bad-list", ...methods, panels: "details" }), /panels must be an array/);
  assert.throws(() => registry.require("missing"), /Unknown/);
  assert.equal(createDefaultDomainRegistry().require("netlist").id, "netlist");
});
