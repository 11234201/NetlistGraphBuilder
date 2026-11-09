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
      worker.onmessage({ data: { error: { name: "ElkNativePhaseError", message: "invalid", diagnostic: { phase: "p0" } } } });
      await assert.rejects(pending, (error) => error.diagnostic.phase === "p0");
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
    (error) => error.name === "ElkNativePhaseError" && !!error.diagnostic);
});
