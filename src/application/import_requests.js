// File reads, pasted text and domain preparation share one import lifetime.
// Invalidating a request cancels pending work, not the last committed workspace.
export function createImportRequests() {
  let current = null;
  return Object.freeze({
    begin() {
      const controller = new AbortController();
      const previous = current;
      current = controller;
      previous?.abort();
      return Object.freeze({
        signal: controller.signal,
        isLatest: () => current === controller,
        isCurrent: () => current === controller && !controller.signal.aborted,
        cancel() {
          if (current !== controller) return;
          controller.abort();
        }
      });
    }
  });
}
