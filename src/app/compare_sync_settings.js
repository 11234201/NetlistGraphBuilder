export function normalizeCompareSyncSettings(settings) {
  const synchronized = settings?.synchronized !== false;
  return {
    synchronized,
    // Older Compare snapshots used the viewport option for click-to-locate too.
    selectionSynchronized: typeof settings?.selectionSynchronized === "boolean"
      ? settings.selectionSynchronized : synchronized,
    focusedRootsSynchronized: settings?.focusedRootsSynchronized !== false
  };
}

// Focus changes can reset the other canvas only when both controls link the two sides.
export function resetCompareRootViewport(compare, side, setTransform) {
  setTransform(side, { x: 0, y: 0, scale: 1 }, compare.focusedRootsSynchronized !== false && compare.synchronized);
}
