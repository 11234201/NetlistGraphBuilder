import assert from "node:assert/strict";
import test from "node:test";
import { createArtifactStore } from "../../src/application/artifact_store.js";
import { createDocumentStore } from "../../src/application/document_store.js";
import { createJobCoordinator } from "../../src/application/job_coordinator.js";
import { createViewSessionStore } from "../../src/application/view_session_store.js";
import { createDocumentEnvelope } from "../../src/contracts/document.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup() {
  const documents = createDocumentStore();
  documents.open(createDocumentEnvelope({ documentId: "doc:1", domainId: "netlist", sourceRevision: 1, model: {} }));
  const sessions = createViewSessionStore([{ sessionId: "view:1", documentId: "doc:1", domainId: "netlist", unitId: "top" }]);
  const artifacts = createArtifactStore();
  return { documents, sessions, artifacts, jobs: createJobCoordinator({ documents, sessions, artifacts }) };
}

test("new jobs suppress old success, failure, and progress for the same session stage", async () => {
  const { jobs, artifacts } = setup();
  const firstTask = deferred();
  const secondTask = deferred();
  const progress = [];
  const first = jobs.start({ sessionId: "view:1", kind: "layout", run: (context) => {
    context.reportProgress("old-before");
    return firstTask.promise;
  }, onProgress: (value) => progress.push(value) });
  await Promise.resolve();
  const second = jobs.start({ sessionId: "view:1", kind: "layout", run: (context) => {
    context.reportProgress("new");
    return secondTask.promise;
  }, onProgress: (value) => progress.push(value) });
  first.context.reportProgress("old-after");
  firstTask.reject(new Error("obsolete"));
  secondTask.resolve("new-layout");
  assert.equal((await first.promise).status, "stale");
  assert.equal((await second.promise).status, "committed");
  assert.deepEqual(progress, ["old-before", "new"]);
  assert.equal(artifacts.get("view:1", "layout").value, "new-layout");
});

test("session revisions, source reloads, and close invalidate pending commits", async () => {
  for (const invalidate of [
    ({ sessions }) => sessions.update("view:1", () => ({ viewMode: "focused" })),
    ({ documents }) => documents.open(createDocumentEnvelope({ documentId: "doc:1", domainId: "netlist", sourceRevision: 2, model: {} })),
    ({ sessions, jobs }) => { jobs.cancelSession("view:1"); sessions.close("view:1"); }
  ]) {
    const state = setup();
    const task = deferred();
    const job = state.jobs.start({ sessionId: "view:1", kind: "render", run: () => task.promise });
    await Promise.resolve();
    invalidate(state);
    task.resolve("obsolete");
    assert.equal((await job.promise).status, "stale");
    assert.equal(state.artifacts.get("view:1", "render"), null);
  }
});
