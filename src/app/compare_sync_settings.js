export function normalizeCompareSyncSettings(settings) {
  const synchronized = settings?.synchronized !== false;
  return {
    synchronized,
    // Older Compare snapshots used the viewport option for click-to-locate too.
    selectionSynchronized: typeof settings?.selectionSynchronized === "boolean"
      ? settings.selectionSynchronized : synchronized
  };
}
