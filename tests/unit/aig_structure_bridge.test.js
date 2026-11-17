import test from "node:test";
import assert from "node:assert/strict";
import { createAigStructureBridge } from "../../src/app/aig_structure_bridge.js";
import { createDocumentStore } from "../../src/application/document_store.js";
import { createViewSessionStore } from "../../src/application/view_session_store.js";
import { createArtifactStore } from "../../src/application/artifact_store.js";
import { createJobCoordinator } from "../../src/application/job_coordinator.js";
import { createDocumentEnvelope } from "../../src/contracts/document.js";

async function harness(t, results, detailNodes = []) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame");
  Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: () => 0 });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "requestAnimationFrame", previous); else delete globalThis.requestAnimationFrame; });
  const documents = createDocumentStore(), sessions = createViewSessionStore();
  const jobs = createJobCoordinator({ documents, sessions, artifacts: createArtifactStore() });
  const document = documents.open(createDocumentEnvelope({ domainId: "fixture", documentId: "bridge", sourceRevision: 1, source: { name: "bridge", kind: "text" }, model: {} }));
  const session = sessions.create({ sessionId: "bridge", documentId: document.documentId, domainId: "fixture", unitId: "whole" });
  const query = { get: (id) => results.find((result) => result.id === id),
    list: (category, type) => results.filter((result) => result.category === category && (category !== "block" || type === "all" || type === result.kind)) };
  const feature = { createAnalysisService: () => ({ run: async () => ({ status: "complete" }),
    detail: async ({ id }) => ({ id, status: "complete", nodeIds: detailNodes }), dispose() {} }), queryAnalysis: () => query,
    analysisPresentation: (_workspace, view) => ({ nodeRoles: new Map((view.detail?.nodeIds || []).map((id) => [id, "path"])) }) };
  const workspace = { document, sessionId: session.sessionId, feature, positionedNodes: new Map([
    ["s", { x: 0, y: 0, width: 20, height: 20 }], ["t", { x: 40, y: 40, width: 20, height: 20 }],
    ["extra", { x: 1000, y: 500, width: 20, height: 20 }]
  ]) };
  const panel = { selectedId: null, category: "block", type: "xor", page: 0 }, focused = [];
  const bridge = createAigStructureBridge({ jobs, mount: { querySelector: () => null }, readWorkspace: () => workspace,
    readPanelState: () => panel, readPolicy: () => ({}), renderPanels() {}, persist() {}, focus: (bounds) => focused.push(bounds) });
  t.after(() => bridge.dispose());
  bridge.attach(workspace, new Map()); bridge.action({ aigAnalysisAction: "run" });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  await settle();
  return { bridge, panel, focused, settle };
}

test("locate includes highlighted path-union nodes outside the two witness paths", async (t) => {
  const result = { id: "pair", category: "reconvergence", paths: [{ nodeIds: ["s", "t"] }, { nodeIds: ["s", "t"] }] };
  const f = await harness(t, [result], ["s", "t", "extra"]);
  f.bridge.choose(result.id); await f.settle();
  assert.equal(f.bridge.locate(), true);
  assert.deepEqual(f.focused.at(-1), { x: 0, y: 0, width: 1020, height: 520 });
});

test("following a related result reveals its actual page after changing the filter", async (t) => {
  const results = Array.from({ length: 250 }, (_, i) => ({ id: `block:${i}`, category: "block", kind: i === 150 ? "mux" : "xor" }));
  const f = await harness(t, results);
  f.bridge.choose("block:150");
  assert.equal(f.panel.type, "all"); assert.equal(f.panel.page, 1);
  f.bridge.choose("block:249"); assert.equal(f.panel.page, 2);
});
