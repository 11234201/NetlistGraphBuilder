// Attach a command receipt only to render work started by that command. UI
// actions started while the command is awaiting its layout own separate work.
export function createRemoteRenderCompletion() {
  let current = null;
  function within(batch, operation) {
    const previous = current;
    current = batch;
    try { return operation(); } finally { current = previous; }
  }
  function callbacks(options, success = "onRendered") {
    if (!current) return options;
    const batch = current;
    let finish;
    batch.push(new Promise(resolve => { finish = resolve; }));
    const settle = (name, error) => (...args) => within(batch, () => {
      try { return options[name]?.(...args); }
      catch (cause) { finish(cause); throw cause; }
      finally { finish(error?.(...args)); }
    });
    return { ...options, [success]:settle(success), onFailed:settle("onFailed", error => error),
      onCancelled:settle("onCancelled", () => new DOMException("Command render superseded", "AbortError")) };
  }
  function observe(promise) {
    if (current && promise?.then) current.push(promise.then(result => result?.cancelled
      ? new DOMException("Command render superseded", "AbortError") : undefined, error => error));
    return promise;
  }
  async function run(operation) {
    const batch = [];
    const result = await within(batch, operation);
    for (const pending of batch) {
      const error = await pending;
      if (error) throw error;
    }
    return result;
  }
  return { callbacks, observe, run };
}
