// Storage scheduling is independent of history transactions and UI messaging.
// readSnapshot runs at flush time so a burst saves the latest committed view.
export function createDebouncedPersistence({
  readSnapshot, save, onFailure = () => {}, onRecovered = () => {},
  delayMs = 150, schedule = setTimeout, cancel = clearTimeout
}) {
  let timer = null;
  let failed = false;

  function flush() {
    if (timer !== null) cancel(timer);
    timer = null;
    let result;
    try { result = save(readSnapshot()); }
    catch (error) { result = { ok: false, error }; }
    if (result.ok) {
      const recovered = failed;
      failed = false;
      if (recovered) onRecovered();
    } else if (!failed) {
      failed = true;
      onFailure(result.error);
    }
    return result;
  }

  return Object.freeze({
    request() {
      if (timer !== null) cancel(timer);
      timer = schedule(flush, delayMs);
    },
    flush,
    cancel() {
      if (timer !== null) cancel(timer);
      timer = null;
    }
  });
}
