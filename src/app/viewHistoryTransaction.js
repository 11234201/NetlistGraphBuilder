/**
 * One operation owns one history identity across synchronous work and explicitly
 * bound continuations. Async work never keeps the global capture scope active.
 * New operations and explicit navigation invalidation retire older continuations
 * before they can change the UI or publish another history snapshot.
 */
export function createViewHistoryTransaction({ commit, before = null }) {
  if (typeof commit !== "function") throw new Error("View history transaction commit is required");
  if (before !== null && typeof before !== "function") throw new Error("View history transaction before must be a function");
  let active = null;
  let nextOperationId = 1;
  let generation = 0;

  const isCurrent = (scope) => Boolean(scope && scope.generation === generation);

  function snapshot(scope, continuation = false) {
    return {
      ...scope.metadata,
      ...(scope.metadata.affectedSessionIds ? { affectedSessionIds: [...scope.metadata.affectedSessionIds] } : {}),
      ...(continuation ? { continuation: true } : {})
    };
  }

  function merge(scope, metadata = {}) {
    const { transactionId, continuation, ...values } = metadata;
    const current = scope.metadata;
    scope.metadata = {
      ...current,
      ...values,
      label: current.label || values.label,
      ...(current.affectedSessionIds || values.affectedSessionIds ? {
        affectedSessionIds: [...new Set([...(current.affectedSessionIds || []), ...(values.affectedSessionIds || [])])]
      } : {})
    };
  }

  function publish(scope, continuation) {
    if (!isCurrent(scope)) return;
    const previous = active;
    active = null;
    try { commit(snapshot(scope, continuation)); }
    finally { active = previous; }
  }

  function execute(scope, operation, continuation) {
    const previous = active;
    let result;
    active = scope;
    try { result = operation(); }
    finally { active = previous; }
    publish(scope, continuation);
    if (result && typeof result.then === "function") {
      return Promise.resolve(result).then((value) => {
        publish(scope, true);
        return value;
      });
    }
    return result;
  }

  function run(metadata = {}, operation) {
    if (typeof operation !== "function") throw new Error("View history transaction operation is required");
    if (isCurrent(active)) {
      merge(active, metadata);
      return operation();
    }
    const scope = { generation: ++generation, metadata: { transactionId: `operation:${nextOperationId++}` } };
    merge(scope, metadata);
    before?.(snapshot(scope));
    return execute(scope, operation, false);
  }

  function capture(metadata = {}) {
    if (!isCurrent(active)) return false;
    merge(active, metadata);
    return true;
  }

  function bind(callback, onStale = null) {
    if (typeof callback !== "function") throw new Error("View history continuation must be a function");
    if (onStale !== null && typeof onStale !== "function") throw new Error("Stale history continuation must be a function");
    const scope = isCurrent(active) ? active : null;
    if (!scope) return callback;
    return function (...args) {
      if (!isCurrent(scope)) return onStale?.apply(this, args);
      if (active === scope) return callback.apply(this, args);
      return execute(scope, () => callback.apply(this, args), true);
    };
  }

  function invalidate() {
    generation += 1;
  }

  return Object.freeze({ run, capture, bind, invalidate, isActive: () => isCurrent(active) });
}
