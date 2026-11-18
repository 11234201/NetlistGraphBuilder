import { normalizeStructurePolicy } from "./structure_policy.js";
import { restoreWorkerError } from "../foundation/worker_error.js";

export function createStructureWorkerRuntime(model, { workerFactory, policy: options }) {
  const policy = normalizeStructurePolicy(options);
  let worker = null, pending = null, sequence = 0;
  const abortError = () => Object.assign(new Error("Structure analysis cancelled"), { name: "AbortError" });
  function reset(error) { const old = worker; worker = null; old?.terminate(); pending?.fail(error); }
  function ensureWorker() {
    if (worker) return worker;
    const created = workerFactory(); worker = created;
    created.onmessage = ({ data }) => {
      if (worker !== created || !pending || data.id !== pending.id && !(data.error && data.id === undefined)) return;
      if (data.progress) pending.onProgress?.(data.progress);
      else if (data.error) reset(restoreWorkerError(data.error));
      else pending.succeed(data.result);
    };
    created.onerror = (event) => {
      if (worker !== created) return;
      event.preventDefault?.();
      reset(event.error ?? Object.assign(new Error(event.message || "Structure worker failed"), {
        diagnostic: { file: event.filename, line: event.lineno, column: event.colno }
      }));
    };
    created.onmessageerror = () => { if (worker === created) reset(new Error("Invalid structure worker response")); };
    created.postMessage({ type: "initialize", model });
    return created;
  }
  function request(type, result, { signal, onProgress } = {}) {
    if (signal?.aborted) return Promise.reject(abortError());
    if (pending) reset(abortError());
    return new Promise((resolve, reject) => {
      const id = ++sequence, onAbort = () => reset(abortError());
      const timer = setTimeout(() => reset(Object.assign(new Error("Structure analysis time limit reached"), {
        name: "TimeoutError", code: "structure.timeout", diagnostic: { limitMs: policy.workerTimeoutMs }
      })), policy.workerTimeoutMs);
      const finish = (settle, value) => {
        if (pending?.id !== id) return;
        pending = null; clearTimeout(timer); signal?.removeEventListener("abort", onAbort);
        settle(value);
      };
      pending = { id, succeed: (value) => finish(resolve, value), fail: (error) => finish(reject, error), onProgress };
      signal?.addEventListener("abort", onAbort, { once: true });
      try { ensureWorker().postMessage({ id, type, result, policy }); } catch (error) { reset(error); }
    });
  }
  return Object.freeze({ policy, run: (context) => request("analyze", null, context),
    detail: (result, context) => request("detail", result, context), dispose: () => reset(abortError()) });
}
