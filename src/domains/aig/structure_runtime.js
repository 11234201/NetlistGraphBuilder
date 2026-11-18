import { createStructureWorkerRuntime } from "../../analysis/structure_worker_runtime.js";

export function createAigStructureRuntime(model, options = {}) {
  return createStructureWorkerRuntime(model, {
    workerFactory: () => new Worker(new URL("./structure_worker.js", import.meta.url), { type: "module" }),
    ...options
  });
}
