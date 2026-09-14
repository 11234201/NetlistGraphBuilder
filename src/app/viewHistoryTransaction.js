/**
 * Coalesce nested view commands into one user-visible history transaction.
 * The application still owns the actual snapshot; this helper only controls
 * the commit boundary so render/persistence helpers cannot add intermediate
 * entries while a compound action is in progress.
 */
export function createViewHistoryTransaction({ commit }) {
  if (typeof commit !== "function") throw new Error("View history transaction commit is required");
  let active = null;

  function run(metadata = {}, operation) {
    if (typeof operation !== "function") throw new Error("View history transaction operation is required");
    if (active) return operation();
    active = { ...metadata };
    try {
      return operation();
    } finally {
      const completed = active;
      active = null;
      commit(completed);
    }
  }

  function capture(metadata = {}) {
    if (!active) return false;
    active = {
      ...active,
      ...metadata,
      label: metadata.label || active.label,
      affectedSessionIds: metadata.affectedSessionIds || active.affectedSessionIds
    };
    return true;
  }

  return Object.freeze({ run, capture, isActive: () => Boolean(active) });
}
