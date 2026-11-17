import { normalizeStructurePolicy } from "./structure_policy.js";

export function createAigStructureRuntime(model, { workerFactory = () => new Worker(new URL("./structure_worker.js", import.meta.url), { type: "module" }), policy: options } = {}) {
  const policy = normalizeStructurePolicy(options);
  let worker = null, pending = null, sequence = 0;
  const abortError = () => Object.assign(new Error("AIG structure analysis cancelled"), { name: "AbortError" });
  function reset(error) { const old = worker; worker = null; old?.terminate(); pending?.finish(error); }
  function ensureWorker() {
    if (worker) return worker;
    const created = workerFactory(); worker = created;
    created.onmessage = ({ data }) => {
      if (worker !== created || !pending || data.id !== pending.id && !(data.error && data.id === undefined)) return;
      if (data.progress) pending.onProgress?.(data.progress);
      else if (data.error) reset(Object.assign(new Error(data.error.message), { name: data.error.name }));
      else pending.finish(null, data.result);
    };
    created.onerror = (event) => { if (worker === created) reset(new Error(event.message || "AIG analysis worker failed")); };
    created.onmessageerror = () => { if (worker === created) reset(new Error("Invalid AIG analysis worker response")); };
    created.postMessage({ type: "initialize", model });
    return created;
  }
  function request(type, result, { signal, onProgress } = {}) {
    if (signal?.aborted) return Promise.reject(abortError());
    if (pending) reset(abortError());
    return new Promise((resolve, reject) => {
      const id = ++sequence, onAbort = () => reset(abortError());
      const timer = setTimeout(() => reset(Object.assign(new Error("AIG analysis time limit reached; retry or use a smaller graph"), { name: "TimeoutError" })), policy.workerTimeoutMs);
      const finish = (error, value) => {
        if (pending?.id !== id) return;
        pending = null; clearTimeout(timer); signal?.removeEventListener("abort", onAbort);
        if (error) reject(error); else resolve(value);
      };
      pending = { id, finish, onProgress };
      signal?.addEventListener("abort", onAbort, { once: true });
      try { ensureWorker().postMessage({ id, type, result, policy }); } catch (error) { reset(error); }
    });
  }
  return Object.freeze({ run: (context) => request("analyze", null, context),
    detail: (result, context) => request("detail", result, context), dispose: () => reset(abortError()) });
}
