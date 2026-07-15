export function createLatestFrameScheduler(task, options = {}) {
  const requestFrame = options.requestFrame || globalThis.requestAnimationFrame?.bind(globalThis) ||
    ((callback) => globalThis.setTimeout(callback, 0));
  const cancelFrame = options.cancelFrame || globalThis.cancelAnimationFrame?.bind(globalThis) ||
    ((handle) => globalThis.clearTimeout(handle));
  let frameHandle = null;
  let latestValue;
  let hasPendingValue = false;

  const run = () => {
    frameHandle = null;
    if (!hasPendingValue) return;
    const value = latestValue;
    hasPendingValue = false;
    task(value);
  };

  return {
    schedule(value) {
      latestValue = value;
      hasPendingValue = true;
      if (frameHandle === null) frameHandle = requestFrame(run);
    },
    flush() {
      if (frameHandle !== null) cancelFrame(frameHandle);
      frameHandle = null;
      run();
    },
    cancel() {
      if (frameHandle !== null) cancelFrame(frameHandle);
      frameHandle = null;
      hasPendingValue = false;
    },
    get pending() {
      return hasPendingValue;
    }
  };
}
