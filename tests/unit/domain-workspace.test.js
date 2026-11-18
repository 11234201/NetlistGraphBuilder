import assert from "node:assert/strict";
import test from "node:test";
import { createDomainWorkspace } from "../../src/application/domain_workspace.js";
import { createDocumentStore } from "../../src/application/document_store.js";
import { createViewSessionStore } from "../../src/application/view_session_store.js";
import { createArtifactStore } from "../../src/application/artifact_store.js";
import { createJobCoordinator } from "../../src/application/job_coordinator.js";
import { createDocumentEnvelope } from "../../src/contracts/document.js";
import { createDomainWorkspaceStorage } from "../../src/persistence/domain_workspace_storage.js";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness({ importSource, layout, onCommit = () => true } = {}) {
  const documents = createDocumentStore(), sessions = createViewSessionStore(), artifacts = createArtifactStore();
  const jobs = createJobCoordinator({ documents, sessions, artifacts });
  const feature = {
    importSource: importSource || ((input, context) => createDocumentEnvelope({ ...context,
      domainId: "fixture", source: { name: input.name, kind: "text" }, model: { name: input.name } })),
    listUnits: () => [{ id: "whole" }], normalizePresentation: () => ({}),
    createWorkspaceStages: () => ({ query: ({ document }) => document.model,
      project: (value) => value, measure: (value) => value,
      layout: layout || ((value) => value), applyOverrides: (value) => value,
      createScene: (value) => ({ name: value.name, readNodes: () => [] }) }),
    describeWorkspace: (_document, pipeline) => ({ scene: pipeline.scene, graph: pipeline.graph })
  };
  const workspace = createDomainWorkspace({ documents, sessions, jobs,
    registry: { require: () => feature }, layout: null, onCommit });
  return { workspace, documents, sessions, artifacts, feature };
}

test("candidate failure keeps the active document/session/artifact and closes failed candidate", async () => {
  let fail = false;
  const state = harness({ layout(value) { if (fail) throw new Error("layout failed"); return value; } });
  const previous = await state.workspace.open("fixture", { name: "working" });
  fail = true;
  let context;
  await assert.rejects(state.workspace.open("fixture", { name: "broken" }, null, (value) => { context = value; }), /layout failed/);
  assert.notEqual(context.documentId, previous.document.documentId);
  assert.notEqual(context.sessionId, previous.sessionId);
  assert.ok(context.jobId);
  assert.equal(state.workspace.read(), previous);
  assert.deepEqual(state.documents.list().map((item) => item.source.name), ["working"]);
  assert.equal(state.sessions.list().length, 1);
  assert.equal(state.artifacts.list().length, 1);
  assert.equal(typeof state.artifacts.list()[0].value.scene.readNodes, "function");
});

test("out-of-order asynchronous source imports cannot replace the latest candidate", async () => {
  const first = deferred();
  const state = harness();
  const importSource = state.feature.importSource;
  state.feature.importSource = (input, context) => input.name === "first"
    ? first.promise.then(() => importSource(input, context)) : importSource(input, context);
  const obsolete = state.workspace.open("fixture", { name: "first" });
  const current = await state.workspace.open("fixture", { name: "second" });
  first.resolve();
  assert.equal(await obsolete, null);
  assert.equal(state.workspace.read(), current);
  assert.deepEqual(state.documents.list().map((item) => item.source.name), ["second"]);
  assert.equal(state.sessions.list().length, 1);
});

test("cancel aborts the pending job, retains the previous view and ignores late layout", async () => {
  const pending = deferred(), entered = deferred();
  let observedSignal;
  const state = harness({ layout(value, { signal }) {
    if (value.name !== "pending") return value;
    observedSignal = signal; entered.resolve();
    return pending.promise.then(() => value);
  } });
  const previous = await state.workspace.open("fixture", { name: "working" });
  const cancelled = state.workspace.open("fixture", { name: "pending" });
  await entered.promise;
  state.workspace.cancel();
  assert.equal(observedSignal.aborted, true);
  pending.resolve();
  assert.equal(await cancelled, null);
  assert.equal(state.workspace.read(), previous);
  assert.equal(state.documents.list().length, 1);
  assert.equal(state.sessions.list().length, 1);
  assert.equal(state.artifacts.list().length, 1);
});

test("staged mount becoming stale never commits and leave removes active runtime artifacts", async () => {
  const mounted = deferred(), entered = deferred();
  const state = harness({ async onCommit(value, _restore, isCurrent) {
    if (value.document.source.name !== "pending") return true;
    entered.resolve(); await mounted.promise; return isCurrent();
  } });
  await state.workspace.open("fixture", { name: "working" });
  const cancelled = state.workspace.open("fixture", { name: "pending" });
  await entered.promise;
  state.workspace.leave();
  mounted.resolve();
  assert.equal(await cancelled, null);
  assert.equal(state.workspace.read(), null);
  assert.deepEqual(state.documents.list(), []);
  assert.deepEqual(state.sessions.list(), []);
  assert.deepEqual(state.artifacts.list(), []);
});

test("invalid restored session is rejected without leaving an orphan document", async () => {
  const state = harness();
  const previous = await state.workspace.open("fixture", { name: "working" });
  await assert.rejects(state.workspace.open("fixture", { name: "bad-session" }, { viewport: { x: 0, y: 0, scale: -1 } }), /viewport/);
  assert.equal(state.workspace.read(), previous);
  assert.deepEqual(state.documents.list().map((item) => item.source.name), ["working"]);
  assert.equal(state.sessions.list().length, 1);
});

test("relayout failure and cancellation retain the active shared document and its artifacts", async () => {
  const blocked = deferred(), entered = deferred();
  let action = "ready";
  const state = harness({ layout(value) {
    if (action === "fail") throw new Error("layout failed");
    if (action === "hold") { entered.resolve(); return blocked.promise.then(() => value); }
    return value;
  } });
  const previous = await state.workspace.open("fixture", { name: "working" });
  action = "fail";
  await assert.rejects(state.workspace.relayout({}), /layout failed/);
  assert.equal(state.workspace.read(), previous);
  action = "hold";
  const cancelled = state.workspace.relayout({});
  await entered.promise;
  state.workspace.cancel();
  action = "ready";
  const next = await state.workspace.relayout({});
  blocked.resolve();
  assert.equal(await cancelled, null);
  assert.equal(state.workspace.read(), next);
  assert.equal(next.document, previous.document);
  assert.deepEqual(state.documents.list(), [previous.document]);
  assert.equal(state.sessions.list().length, 1);
  assert.equal(state.artifacts.list().length, 1);
});

test("stale relayout mount cannot close a newer session on the same document", async () => {
  const mounted = deferred(), entered = deferred();
  let hold = false;
  const state = harness({ async onCommit(_value, _restore, isCurrent) {
    if (hold) { hold = false; entered.resolve(); await mounted.promise; }
    return isCurrent();
  } });
  await state.workspace.open("fixture", { name: "working" });
  hold = true;
  const stale = state.workspace.relayout({});
  await entered.promise;
  const current = await state.workspace.relayout({});
  mounted.resolve();
  assert.equal(await stale, null);
  assert.equal(state.workspace.read(), current);
  assert.equal(state.documents.list().length, 1);
  assert.equal(state.sessions.require(current.sessionId).documentId, current.document.documentId);
  assert.equal(state.artifacts.list().length, 1);
});

test("domain storage acquisition is lazy so denied browser storage cannot break composition", () => {
  let reads = 0;
  const storage = createDomainWorkspaceStorage(() => { reads += 1; throw new Error("Storage denied"); });
  assert.equal(reads, 0);
  assert.throws(() => storage.load(), /Storage denied/);
  assert.equal(reads, 1);
  assert.throws(() => storage.clear(), /Storage denied/);
  assert.equal(reads, 2);
});

test("domain archive preserves source identity and view state without runtime artifacts", () => {
  const values = new Map();
  const storage = createDomainWorkspaceStorage({
    getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key)
  });
  assert.equal(storage.load(), null);
  const value = { domainId: "aig", source: { name: "图.blif", format: "blif", text: ".model x\n.end" },
    selectedId: "n1", viewport: { x: 10, y: 20, scale: 2 }, presentationPolicy: { critical: true, fanout: false, fanoutThreshold: 3 },
    panels: { navigator: { tab: "objects", query: "input" }, inspector: { tab: "source" } },
    runtime: { worker: () => {} } };
  storage.save(value);
  const restored = storage.load();
  assert.equal(restored.kind, "domain-workspace");
  assert.equal(restored.version, 1);
  assert.equal(restored.normalizationVersion, 1);
  for (const field of ["domainId", "source", "selectedId", "viewport", "presentationPolicy", "panels"]) {
    assert.deepEqual(restored[field], value[field]);
  }
  assert.equal("runtime" in restored, false);
  storage.clear();
  assert.equal(storage.load(), null);
});
