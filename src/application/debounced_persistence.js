// Storage scheduling is independent of history transactions and UI messaging.
// readSnapshot runs at flush time so a burst saves the latest committed view.
export function createDebouncedPersistence({
  readSnapshot, save, onFailure = () => {}, onRecovered = () => {},
  delayMs = 150, schedule = setTimeout, cancel = clearTimeout, canFlush = () => true
}) {
  let timer = null;
  let failed = false;

  function flushWhenIdle() {
    timer = null;
    // A previous gesture's delayed save can otherwise fire during the next
    // gesture. Defer both snapshot construction and storage until it is idle.
    if (!canFlush()) { timer = schedule(flushWhenIdle, delayMs); return; }
    flush();
  }

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
      timer = schedule(flushWhenIdle, delayMs);
    },
    flush,
    cancel() {
      if (timer !== null) cancel(timer);
      timer = null;
    }
  });
}
