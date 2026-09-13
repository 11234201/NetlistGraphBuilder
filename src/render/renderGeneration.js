/**
 * Monotonic guard for progressive DOM rendering. Computation jobs have their
 * own session/source revision checks; this token only answers whether a
 * render completion is still allowed to touch its mount.
 */
export function createRenderGeneration() {
  let revision = 0;

  function begin() {
    revision += 1;
    return capture(revision);
  }

  function current() {
    return capture(revision);
  }

  function capture(expectedRevision) {
    return Object.freeze({
      id: expectedRevision,
      isCurrent: () => expectedRevision === revision,
      guard: (callback) => (...args) => expectedRevision === revision ? callback(...args) : undefined
    });
  }

  return Object.freeze({ begin, current });
}
