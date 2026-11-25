import assert from "node:assert/strict";
import test from "node:test";
import { Worker as NodeWorker } from "node:worker_threads";
import { executeNativeLayout } from "../../src/layout/native_layout_execution.js";

function workerStub() {
  return { terminated: false, postMessage(value) { this.request = value; }, terminate() { this.terminated = true; } };
}

test("native worker cancellation terminates computation without accepting a late result", async () => {
  const worker = workerStub();
  const controller = new AbortController();
  const pending = executeNativeLayout({ nodes: [], edges: [] }, { signal: controller.signal, profile: "anchor" }, () => worker);
  assert.equal(worker.request.options.signal, undefined);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(worker.terminated, true);
  assert.equal(worker.onmessage, null);
});

test("native workers release resources on success, phase errors and transport failure", async () => {
  for (const outcome of ["success", "phase", "transport"]) {
    const worker = workerStub();
    const pending = executeNativeLayout({}, {}, () => worker);
    if (outcome === "success") {
      worker.onmessage({ data: { result: { nodes: [] } } });
      assert.deepEqual(await pending, { nodes: [] });
    } else if (outcome === "phase") {
      worker.onmessage({ data: { error: { name: "AnchorLayeredPhaseError", message: "invalid", stack: "worker-stack", diagnostic: { phase: "p0" } } } });
      await assert.rejects(pending, (error) => error.diagnostic.phase === "p0" && error.stack === "worker-stack");
    } else {
      worker.onerror({ message: "load failed" });
      await assert.rejects(pending, /load failed/);
    }
    assert.equal(worker.terminated, true);
  }
});

test("in-process native execution yields to timer cancellation by default", async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 0);
  try {
    await assert.rejects(executeNativeLayout({ nodes: [{ id: "a", width: 20, height: 20, ports: [] }], edges: [] },
      { signal: controller.signal }, null), { name: "AbortError" });
  } finally { clearTimeout(timer); }
});

test("offline worker entry returns the same AnchorLayered geometry across the structured-clone boundary", async () => {
  const workerUrl = new URL("../../src/layout/native_layout_worker.js", import.meta.url).href;
  const factory = () => {
    const bridge = new NodeWorker(new URL(`data:text/javascript,${encodeURIComponent(`
      import { parentPort } from 'node:worker_threads';
      globalThis.self = { postMessage: (data) => parentPort.postMessage(data) };
      await import(${JSON.stringify(workerUrl)});
      parentPort.on('message', (data) => self.onmessage({ data }));
    `)}`));
    const adapter = {
      postMessage: (data) => bridge.postMessage(data),
      terminate: () => bridge.terminate()
    };
    bridge.on("message", (data) => adapter.onmessage?.({ data }));
    bridge.on("error", (error) => adapter.onerror?.(error));
    return adapter;
  };
  const input = { nodes: [
    { id: "a", width: 20, height: 20, ports: [{ id: "out", side: "EAST", x: 20, y: 10, width: 0, height: 0 }] },
    { id: "b", width: 20, height: 20, ports: [{ id: "in", side: "WEST", x: 0, y: 10, width: 0, height: 0 }] }
  ], edges: [{ id: "e", sourcePortId: "out", targetPortId: "in", physicalNetId: "n" }] };
  const expected = await executeNativeLayout(input, { profile: "anchor" }, null);
  assert.deepEqual(await executeNativeLayout(input, { profile: "anchor" }, factory), expected);
  await assert.rejects(executeNativeLayout({ nodes: [], edges: input.edges }, { profile: "anchor" }, factory),
    (error) => error.name === "AnchorLayeredPhaseError" && !!error.diagnostic && /anchor_layered\//.test(error.stack));
});

test("worker failure transport retains error chains and bounds arbitrary thrown values", async () => {
  const { serializeWorkerError } = await import("../../src/foundation/worker_error.js");
  const cause = Object.assign(new Error("inner"), { code: "ORIGINAL" });
  const outer = new Error("outer", { cause });
  outer.diagnostic = { callback() {}, cyclic: outer };
  for (const thrown of [outer, "primitive", null]) {
    const worker = workerStub();
    const pending = executeNativeLayout({}, {}, () => worker);
    worker.onmessage({ data: { error: structuredClone(serializeWorkerError(thrown)) } });
    await assert.rejects(pending, (error) => {
      if (thrown !== outer) return error.message === String(thrown);
      assert.equal(error.cause.code, cause.code);
      assert.equal(error.cause.stack, cause.stack);
      assert.equal(error.stack, outer.stack);
      assert.equal(error.diagnostic.cyclic, "[Circular]");
      return true;
    });
  }
  for (const data of [undefined, null, {}, { error: null }]) {
    const worker = workerStub();
    const pending = executeNativeLayout({}, {}, () => worker);
    worker.onmessage({ data });
    await assert.rejects(pending, /Invalid native layout worker/);
    assert.equal(worker.terminated, true);
  }
  const worker = workerStub();
  const pending = executeNativeLayout({}, {}, () => worker);
  worker.onerror({ error: outer, message: "worker died", filename: "layout.js", lineno: 123, colno: 4 });
  await assert.rejects(pending, (error) => error.cause === outer && error.diagnostic.line === 123 &&
    error.diagnostic.column === 4 && error.diagnostic.filename === "layout.js");
});

test("native worker startup and send preserve falsy rejection reasons", async () => {
  for (const reason of [null, 0]) {
    const worker = workerStub();
    worker.postMessage = () => { throw reason; };
    for (const factory of [() => { throw reason; }, () => worker]) {
      const pending = executeNativeLayout({}, {}, factory);
      await pending.then(() => assert.fail("worker failure resolved as a layout"), error => assert.equal(error, reason));
    }
    assert.equal(worker.terminated, true);
  }
});

test("worker cleanup exceptions cannot leave a completed layout pending", async () => {
  for (const outcome of ["success", "failure", "transport", "cancel"]) {
    let abort;
    const signal = { aborted: false, addEventListener(_type, listener) { abort = listener; }, removeEventListener() {} };
    const worker = workerStub();
    const cleanup = new Error("terminate failed");
    worker.terminate = () => { throw cleanup; };
    const pending = executeNativeLayout({}, { signal }, () => worker);
    const error = new Error("original failure");
    if (outcome === "success") {
      assert.throws(() => worker.onmessage({ data: { result: { nodes: [] } } }), cleanup);
      assert.deepEqual(await pending, { nodes: [] });
    } else if (outcome === "failure") {
      assert.throws(() => worker.onerror({ message: error.message, error }), cleanup);
      await assert.rejects(pending, value => value.cause === error);
    } else if (outcome === "cancel") {
      assert.throws(() => abort(), cleanup);
      await assert.rejects(pending, { name: "AbortError" });
    } else {
      assert.throws(() => worker.onmessageerror(), cleanup);
      await assert.rejects(pending, /Invalid native layout worker response/);
    }
    assert.equal(worker.onmessage, null);
  }
});
