export const GRAPHVIZ_RUNTIME_VERSION = "viz-3.31.0/graphviz-16.1.0";
export const GRAPHVIZ_DEFAULT_TIMEOUT_MS = 20000;

/** One retained, lazily created worker per client; a cancelled synchronous WASM call is terminated. */
export function createGraphvizRuntime({ workerFactory = createWorker, timeoutMs = GRAPHVIZ_DEFAULT_TIMEOUT_MS } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Graphviz timeout must be positive");
  let worker = null;
  let sequence = 0;
  let disposed = false;
  const pending = new Map();

  function reset(error) {
    const previous = worker;
    worker = null;
    previous?.terminate();
    for (const request of [...pending.values()]) request.finish(error);
  }

  function ensureWorker() {
    if (worker) return worker;
    const created = workerFactory();
    worker = created;
    created.onmessage = ({ data }) => {
      if (worker !== created) return;
      const request = pending.get(data.id);
      if (!request) return;
      if (data.error) {
        const error = new Error(data.error.message);
        error.name = data.error.name || "Error";
        request.finish(error);
      } else request.finish(null, data.result);
    };
    created.onerror = (event) => {
      if (worker === created) reset(new Error(event.message || "Graphviz worker failed"));
    };
    created.onmessageerror = () => {
      if (worker === created) reset(new Error("Invalid Graphviz worker response"));
    };
    return created;
  }

  function render(dot, { signal, format = "json" } = {}) {
    if (disposed) return Promise.reject(new Error("Graphviz runtime has been disposed"));
    if (signal?.aborted) return Promise.reject(abortError());
    if (typeof dot !== "string" || !["json", "dot_json"].includes(format)) {
      return Promise.reject(new Error("Expected DOT source and json or dot_json result format"));
    }
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const onAbort = () => reset(abortError());
      const timer = setTimeout(() => reset(Object.assign(new Error(`Graphviz exceeded ${timeoutMs} ms`), { name: "TimeoutError" })), timeoutMs);
      const finish = (error, result) => {
        if (!pending.delete(id)) return;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (error) reject(error); else resolve(result);
      };
      pending.set(id, { finish });
      signal?.addEventListener("abort", onAbort, { once: true });
      try { ensureWorker().postMessage({ id, dot, format }); }
      catch (error) { reset(error); }
    });
  }

  return Object.freeze({
    version: GRAPHVIZ_RUNTIME_VERSION,
    render,
    dispose() { disposed = true; reset(abortError()); }
  });
}

function createWorker() {
  if (typeof Worker === "undefined") throw new Error("Graphviz requires browser Web Worker support");
  return new Worker(new URL("./graphviz_worker.js", import.meta.url), { type: "module" });
}

function abortError() {
  return Object.assign(new Error("Graphviz job cancelled"), { name: "AbortError" });
}
