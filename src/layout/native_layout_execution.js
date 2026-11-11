import { layoutGraph } from "./anchor_layered/index.js";
import { checkCancelled } from "./anchor_layered/protocol.js";

// Browser jobs own a dedicated worker so abort can interrupt a synchronous
// phase. CLI/research callers retain phase hooks and an in-process fallback.
export function executeNativeLayout(input, options = {}, workerFactory = defaultWorkerFactory) {
  checkCancelled(options.signal);
  if (options.onPhase || options.yieldControl || !workerFactory) {
    return layoutGraph(input, { ...options, yieldControl: options.yieldControl || createHostYield() });
  }
  return new Promise((resolve, reject) => {
    let worker;
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", abort);
      if (worker) {
        worker.onmessage = worker.onerror = worker.onmessageerror = null;
        worker.terminate();
      }
      if (error) reject(error); else resolve(result);
    };
    const abort = () => {
      const error = new Error("Layout cancelled");
      error.name = "AbortError";
      finish(error);
    };
    try {
      worker = workerFactory();
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) { abort(); return; }
      worker.onmessage = ({ data }) => {
        if (data.error) {
          const error = new Error(data.error.message);
          error.name = data.error.name;
          if (typeof data.error.stack === "string") error.stack = data.error.stack;
          if (data.error.diagnostic) error.diagnostic = data.error.diagnostic;
          finish(error);
        } else finish(null, data.result);
      };
      worker.onerror = (event) => finish(new Error(event.message || "Native layout worker failed"));
      worker.onmessageerror = () => finish(new Error("Invalid native layout worker response"));
      const { signal, onPhase, yieldControl, ...parameters } = options;
      worker.postMessage({ input, options: parameters });
    } catch (error) { finish(error); }
  });
}

const defaultWorkerFactory = typeof globalThis.Worker === "function"
  ? () => new Worker(new URL("./native_layout_worker.js", import.meta.url), { type: "module" })
  : null;

function createHostYield() {
  let deadline = 0;
  return () => {
    if (performance.now() < deadline) return;
    return new Promise((resolve) => setTimeout(() => {
      deadline = performance.now() + 8;
      resolve();
    }, 0));
  };
}
