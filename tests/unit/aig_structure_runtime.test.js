import test from "node:test";
import assert from "node:assert/strict";
import { createAigStructureRuntime } from "../../src/domains/aig/structure_runtime.js";
import { createWorkspaceAnalysis } from "../../src/application/workspace_analysis.js";
import { createDocumentStore } from "../../src/application/document_store.js";
import { createViewSessionStore } from "../../src/application/view_session_store.js";
import { createArtifactStore } from "../../src/application/artifact_store.js";
import { createJobCoordinator } from "../../src/application/job_coordinator.js";
import { createDocumentEnvelope } from "../../src/contracts/document.js";
import { serializeWorkerError } from "../../src/foundation/worker_error.js";

test("structure worker cancellation, stale replies, initialization failures and timeout are isolated", async () => {
  const workers = [];
  const runtime = createAigStructureRuntime({ nodes: [], edges: [] }, { policy: { workerTimeoutMs: 100 }, workerFactory() {
    const worker = { messages: [], terminated: false, postMessage(value) { this.messages.push(value); }, terminate() { this.terminated = true; } };
    workers.push(worker); return worker;
  } });
  const abort = new AbortController(), first = runtime.run({ signal: abort.signal });
  abort.abort(); await assert.rejects(first, { name: "AbortError" });
  assert.equal(workers[0].terminated, true);
  const progress = [], second = runtime.run({ onProgress: (value) => progress.push(value) });
  const request = workers[1].messages.at(-1);
  workers[0].onmessage({ data: { id: 1, result: "stale" } });
  workers[1].onmessage({ data: { id: request.id, progress: { stage: "blocks" } } });
  workers[1].onmessage({ data: { id: request.id, result: { status: "complete" } } });
  assert.deepEqual(await second, { status: "complete" }); assert.equal(progress.length, 1);
  const third = runtime.detail({ id: "test" });
  const original = Object.assign(new TypeError("initialize failed", { cause: new Error("bad index") }), {
    code: "bad-input", diagnostic: { line: 23, objectId: "n0", rawText: "private" }
  });
  workers[1].onmessage({ data: { error: serializeWorkerError(original) } });
  await assert.rejects(third, (error) => {
    assert.equal(error.stack, original.stack);
    assert.equal(error.cause.stack, original.cause.stack);
    assert.deepEqual(error.diagnostic, { line: 23, objectId: "n0" });
    assert.equal(error.code, "bad-input");
    return true;
  });
  await assert.rejects(runtime.run(), { name: "TimeoutError" });
  assert.equal(workers[2].terminated, true); runtime.dispose();
});

test("analysis jobs survive same-document relayout, reject stale sources and keep artifacts out of sessions", async () => {
  const documents = createDocumentStore(), sessions = createViewSessionStore(), artifacts = createArtifactStore();
  const jobs = createJobCoordinator({ documents, sessions, artifacts }), scheduled = [], pending = [];
  let disposed = 0;
  const feature = { createAnalysisService: () => ({
    run({ signal }) { return new Promise((resolve) => pending.push({ signal, resolve })); },
    detail: async (result) => ({ id: result.id, nodeIds: [], edgeIds: [], status: "complete" }), dispose() { disposed++; }
  }) };
  function workspace(id) {
    const document = documents.open(createDocumentEnvelope({ domainId: "fixture", documentId: id, sourceRevision: 1, source: { name: id, kind: "text" }, model: {} }));
    const session = sessions.create({ sessionId: id, documentId: id, domainId: "fixture", unitId: "whole" });
    return { document, sessionId: session.sessionId, feature };
  }
  const manager = createWorkspaceAnalysis({ jobs, schedule: (callback) => scheduled.push(callback) });
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const first = workspace("first");
  manager.bind(first); scheduled.shift()(); await tick();
  assert.equal(manager.read().status, "running");
  const second = workspace("second"); manager.bind(second); scheduled.shift()(); await tick();
  assert.equal(pending[0].signal.aborted, true);
  pending[0].resolve({ status: "complete", marker: "old" });
  pending[1].resolve({ status: "complete", marker: "new" }); await tick();
  assert.equal(manager.read().data.marker, "new");
  const data = manager.read().data;
  const relayout = { ...second, sessionId: sessions.create({ sessionId: "relayout", documentId: "second", domainId: "fixture", unitId: "whole" }).sessionId };
  manager.bind(relayout); assert.equal(manager.read().data, data); assert.equal(pending.length, 2);
  const rerun = manager.run(); await tick(); manager.bind({ ...relayout }); scheduled.shift()(); await tick();
  assert.equal(pending[2].signal.aborted, true);
  pending[2].resolve({ status: "complete", marker: "obsolete retry" }); pending[3].resolve({ status: "complete", marker: "retry" });
  await rerun; await tick(); assert.equal(manager.read().data.marker, "retry");
  await manager.detail({ id: "pair" }); assert.equal(manager.read().detail.id, "pair");
  assert.doesNotMatch(JSON.stringify(sessions.list()), /nodeIds|edgeIds|marker/);
  manager.dispose(); assert.equal(disposed, 2);
});

function analysisHarness(overrides = {}, logProcess) {
  const documents = createDocumentStore(), sessions = createViewSessionStore(), artifacts = createArtifactStore();
  const jobs = createJobCoordinator({ documents, sessions, artifacts }), scheduled = [];
  const document = documents.open(createDocumentEnvelope({ domainId: "fixture", documentId: "analysis", sourceRevision: 1, source: { name: "analysis", kind: "text" }, model: {} }));
  let runs = 0, serial = 0;
  const service = { run: async () => { runs++; return { status: "complete" }; },
    detail: async ({ id }) => { if (id === "failed") throw new Error("detail failed"); return { id, status: "complete" }; }, dispose() {}, ...overrides };
  const feature = { createAnalysisService: () => service };
  const workspace = () => ({ document, feature, sessionId: sessions.create({ sessionId: `view:${++serial}`, documentId: document.documentId, domainId: "fixture", unitId: "whole" }).sessionId });
  const manager = createWorkspaceAnalysis({ jobs, logProcess, schedule: (callback) => scheduled.push(callback) });
  manager.bind(workspace());
  return { manager, workspace, runs: () => runs,
    async flush() { for (const callback of scheduled.splice(0)) callback(); await new Promise((resolve) => setImmediate(resolve)); } };
}

test("relayout does not silently restart an analysis that was cancelled or failed before producing results", async () => {
  const cancelled = analysisHarness();
  cancelled.manager.cancel(); cancelled.manager.bind(cancelled.workspace()); await cancelled.flush();
  assert.equal(cancelled.manager.read().status, "cancelled"); assert.equal(cancelled.runs(), 0);
  await cancelled.manager.run(); assert.equal(cancelled.runs(), 1); cancelled.manager.dispose();
  const failed = analysisHarness({ run: async () => { throw new Error("analysis failed"); } });
  await failed.manager.run(); failed.manager.bind(failed.workspace());
  assert.equal(failed.manager.read().status, "error"); await failed.flush();
  assert.equal(failed.manager.read().error, "analysis failed"); failed.manager.dispose();
});

test("pending analysis and detail remain valid through geometry changes in the same visible scope", async () => {
  const documents = createDocumentStore(), sessions = createViewSessionStore(), artifacts = createArtifactStore();
  const jobs = createJobCoordinator({ documents, sessions, artifacts });
  const document = documents.open(createDocumentEnvelope({ domainId: "fixture", documentId: "scope", sourceRevision: 1,
    source: { name: "scope", kind: "text" }, model: {} }));
  const session = sessions.create({ sessionId: "view", documentId: "scope", domainId: "fixture", unitId: "top" });
  let finish;
  const pending = () => new Promise((resolve) => { finish = resolve; });
  const feature = { createAnalysisService: () => ({ run: pending, detail: pending, dispose() {} }) };
  const target = { document, sessionId: session.sessionId, analysisScopeId: "visible:1", feature };
  const manager = createWorkspaceAnalysis({ jobs, schedule() {} });
  manager.bind(target);
  for (const operation of ["run", "detail"]) {
    const task = operation === "run" ? manager.run() : manager.detail({ id: "pair" });
    await Promise.resolve();
    sessions.update(session.sessionId, () => ({ layoutPolicy: { marker: operation } }));
    manager.bind({ ...target });
    finish({ status: "complete" });
    await task;
    assert.equal(manager.read()[operation === "run" ? "status" : "detailStatus"], "complete");
  }
  manager.dispose();
});

test("analysis failures report original reason once, survive sink failure and clear across visible scopes", async () => {
  const reports = [];
  const f = analysisHarness({ run() { throw null; } }, (...args) => { reports.push(args); throw new Error("sink"); });
  const next = { ...f.workspace(), analysisScopeId: "focused:a" };
  f.manager.bind(next); await f.flush();
  assert.equal(f.manager.read().error, "null");
  assert.equal(reports.length, 1);
  const details = reports[0][3];
  assert.equal(details.error, null);
  assert.equal(details.operation, "reconvergence.run");
  assert.equal(details.viewScopeId, "focused:a");
  assert.ok(details.jobId);
  f.manager.bind({ ...next, analysisScopeId: "focused:b" });
  assert.equal(f.manager.read().status, "idle");
  f.manager.dispose();
});

test("cached detail, clearing selection and rerunning analysis discard errors from another result", async () => {
  const { manager } = analysisHarness();
  await manager.run(); await manager.detail({ id: "cached" }); await manager.detail({ id: "failed" });
  assert.equal(manager.read().detailError, "detail failed");
  await manager.detail({ id: "cached" });
  assert.equal(manager.read().detail.id, "cached"); assert.equal(manager.read().detailError, null);
  await manager.detail({ id: "failed" }); await manager.detail(null);
  assert.equal(manager.read().detailError, null);
  await manager.detail({ id: "failed" }); await manager.run();
  assert.equal(manager.read().detailError, null); manager.dispose();
});

test("a completed analysis preserves a failed path detail across relayout until explicitly retried", async () => {
  let attempts = 0;
  const f = analysisHarness({ detail: async ({ id }) => {
    if (++attempts === 1) throw new Error("path union timed out");
    return { id, status: "complete" };
  } });
  await f.manager.run();
  await f.manager.detail({ id: "pair" });
  f.manager.bind(f.workspace());
  assert.equal(f.manager.read().detailStatus, "error");
  assert.equal(f.manager.read().detailError, "path union timed out");
  await f.manager.detail({ id: "pair" });
  assert.equal(f.manager.read().detail.id, "pair");
  assert.equal(f.manager.read().detailError, null);
  f.manager.dispose();
});
