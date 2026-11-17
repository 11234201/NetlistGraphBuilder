import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceExecution } from "../../src/application/workspace_execution.js";

for (const asynchronous of [false, true]) {
  test(`workspace scheduling preserves ${asynchronous ? "async" : "sync"} commit and failure behavior`, async () => {
    const calls = [];
    const run = (request) => {
      calls.push(request.sessionId);
      return request.run({ signal: "signal", jobId: request.sessionId });
    };
    const execution = createWorkspaceExecution({ jobs: {
      runSync: run,
      start: (request) => ({ context: {}, promise: Promise.resolve().then(() => run(request)) })
    } });
    for (const status of ["committed", "stale", "error"]) {
      let commits = 0;
      let errors = 0;
      let started = 0;
      await execution.execute({
        provider: { executionMode: asynchronous ? "async" : "sync" },
        tasks: ["left", "right"].map((sessionId) => ({
          beginComputation: () => ({ sessionId }), kind: "workspace",
          run(context) {
            assert.equal(context.signal, "signal");
            if (sessionId === "right" && status === "error") throw new Error("failure");
            return { status: sessionId === "right" ? status : "committed" };
          }
        })),
        onStarted: () => started++, onCommit: () => commits++, onError: () => errors++
      });
      assert.equal(commits, status === "committed" ? 1 : 0);
      assert.equal(errors, status === "error" ? 1 : 0);
      assert.equal(started, asynchronous ? 1 : 0);
    }
    assert.deepEqual(calls, ["left", "right", "left", "right", "left", "right"]);
  });
}

test("async batch cancels partial startup and never commits after startup callback failure", async () => {
  const cancelled = [];
  const errors = [];
  let commits = 0;
  let startCount = 0;
  const execution = createWorkspaceExecution({ jobs: {
    start(request) {
      startCount += 1;
      if (startCount === 2) throw new Error("right setup failed");
      return {
        promise: Promise.resolve({ status: "committed" }),
        cancel: () => cancelled.push(request.sessionId)
      };
    }
  } });
  await execution.execute({
    provider: { executionMode: "async" },
    tasks: ["left", "right"].map((sessionId) => ({
      beginComputation: () => ({ sessionId }), kind: "workspace", run() {}
    })),
    onCommit: () => commits++, onError: (error) => errors.push(error.message)
  });
  assert.deepEqual(cancelled, ["left"]);
  assert.deepEqual(errors, ["right setup failed"]);
  assert.equal(commits, 0);

  cancelled.length = 0;
  errors.length = 0;
  startCount = 0;
  await execution.execute({
    provider: { executionMode: "async" },
    tasks: [{ beginComputation: () => ({ sessionId: "left" }), kind: "workspace", run() {} }],
    onStarted: () => { throw new Error("presentation failed"); },
    onCommit: () => commits++, onError: (error) => errors.push(error.message)
  });
  assert.deepEqual(cancelled, ["left"]);
  assert.deepEqual(errors, ["presentation failed"]);
  assert.equal(commits, 0);
});

test("external cancellation aborts both workspace jobs and rejects late success without fallback", async () => {
  const controller = new AbortController(), cancelled = [], releases = [], events = [];
  const execution = createWorkspaceExecution({ jobs: { start: (request) => ({
    cancel: () => cancelled.push(request.sessionId),
    promise: new Promise((resolve) => releases.push(() => resolve({ status: "committed" })))
  }) } });
  const pending = execution.execute({ provider: { executionMode: "async" }, signal: controller.signal,
    tasks: ["left", "right"].map((sessionId) => ({ beginComputation: () => ({ sessionId }), kind: "workspace", run() {} })),
    onCommit: () => events.push("commit"), onError: () => events.push("error"),
    onSettled: (results) => events.push(results.map((result) => result.status).join(",")) });
  controller.abort();
  assert.deepEqual(cancelled, ["left", "right"]);
  assert.deepEqual(events, ["cancelled"]);
  releases.forEach((release) => release());
  await pending;
  assert.deepEqual(events, ["cancelled"]);
});

test("an already cancelled workspace request does not begin computation", () => {
  const controller = new AbortController(); controller.abort();
  let settled = 0;
  createWorkspaceExecution({ jobs: {} }).execute({ provider: {}, signal: controller.signal,
    tasks: [{ beginComputation() { assert.fail("cancelled request started"); } }],
    onCommit() { assert.fail("cancelled request committed"); }, onError() { assert.fail("cancellation reached fallback"); },
    onSettled: (results) => { assert.equal(results[0].status, "cancelled"); settled++; } });
  assert.equal(settled, 1);
});

test("a completed layout releases its import cancellation listener", async () => {
  const controller = new AbortController(); let cancelled = 0, committed = 0, settled = 0;
  await createWorkspaceExecution({ jobs: { start: () => ({
    promise: Promise.resolve({ status: "committed" }), cancel: () => cancelled++
  }) } }).execute({ provider: { executionMode: "async" }, signal: controller.signal,
    tasks: [{ beginComputation: () => ({ sessionId: "single" }), kind: "workspace", run() {} }],
    onCommit: () => committed++, onError() { assert.fail("unexpected failure"); }, onSettled: () => settled++ });
  controller.abort();
  assert.deepEqual({ cancelled, committed, settled }, { cancelled: 0, committed: 1, settled: 1 });
});
