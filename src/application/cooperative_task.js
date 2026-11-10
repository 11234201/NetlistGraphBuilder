/** Execute a pure iterator in short, cancellable chunks. No domain knowledge. */
export async function runCooperativeTask(iterator, { signal, onProgress, yieldControl = () => new Promise((resolve) => setTimeout(resolve, 0)) } = {}) {
  const check = () => {
    if (signal?.aborted) { const error = new Error("Import cancelled"); error.name = "AbortError"; throw error; }
  };
  try {
    await yieldControl();
    for (;;) {
      check();
      const started = performance.now();
      let step;
      do {
        check(); step = iterator.next();
        if (step.done) { check(); return step.value; }
      } while (performance.now() - started < 8);
      onProgress?.(step.value);
      await yieldControl();
    }
  } finally { iterator.return?.(); }
}
