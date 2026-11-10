import { parseLibertySteps } from "../../parser/liberty_parser.js";
import { buildLibertyModelSteps } from "../../infer/liberty_model.js";

export function* prepareLibertyImport(text, options) {
  const parsed = yield* parseLibertySteps(text, options);
  return yield* buildLibertyModelSteps(parsed);
}

/** Owns the library attachment; callers get immutable data, never mutable state. */
export function createLibertyLibraryService({ execute }) {
  let snapshot = null, generation = 0, pending = null;
  const cancel = () => { generation += 1; pending?.abort(); pending = null; };
  return Object.freeze({
    read: () => snapshot,
    cancel,
    clear() { cancel(); snapshot = null; },
    async importText(text, options = {}) {
      cancel();
      const controller = new AbortController(); pending = controller;
      const request = generation;
      const abort = () => controller.abort();
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
      try {
        const prepared = await execute(prepareLibertyImport(text, options), { signal: controller.signal, onProgress: options.onProgress });
        if (request !== generation || controller.signal.aborted) { const error = new Error("Import cancelled"); error.name = "AbortError"; throw error; }
        snapshot = prepared;
        return snapshot;
      } finally {
        options.signal?.removeEventListener("abort", abort);
        if (pending === controller) pending = null;
      }
    }
  });
}
