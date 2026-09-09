function requireId(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} is required`);
  return value;
}

export function createViewSession(value) {
  return Object.freeze({
    sessionId: requireId(value?.sessionId, "View sessionId"),
    documentId: requireId(value?.documentId, "View documentId"),
    domainId: requireId(value?.domainId, "View domainId"),
    unitId: requireId(value?.unitId, "View unitId"),
    sessionRevision: Number.isInteger(value.sessionRevision) ? value.sessionRevision : 1,
    computationRevision: Number.isInteger(value.computationRevision) ? value.computationRevision : 1,
    viewMode: value.viewMode || "whole",
    focusedRootRefs: Object.freeze([...(value.focusedRootRefs || [])]),
    activeFocusedRootRef: value.activeFocusedRootRef || null,
    selectedObjectRef: value.selectedObjectRef || null,
    layoutPolicy: Object.freeze({ ...(value.layoutPolicy || {}) }),
    overrides: value.overrides || null,
    viewport: Object.freeze({ ...(value.viewport || { x: 0, y: 0, scale: 1 }) })
  });
}

export function createViewSessionStore(initialSessions = []) {
  const sessions = new Map(initialSessions.map((session) => [session.sessionId, createViewSession(session)]));
  const listeners = new Set();
  const notify = (next, previous) => listeners.forEach((listener) => listener(next, previous));
  const update = (sessionId, decide, options = {}) => {
    const previous = sessions.get(sessionId);
    if (!previous) throw new Error(`Unknown view session: ${sessionId}`);
    const decision = decide(previous);
    if (!decision || decision === previous) return previous;
    const next = createViewSession({
      ...previous,
      ...decision,
      sessionRevision: previous.sessionRevision + 1,
      computationRevision: previous.computationRevision + (options.invalidateComputation === false ? 0 : 1)
    });
    sessions.set(sessionId, next);
    notify(next, previous);
    return next;
  };
  return Object.freeze({
    create(value) {
      if (sessions.has(value?.sessionId)) throw new Error(`Duplicate view session: ${value.sessionId}`);
      const session = createViewSession(value);
      sessions.set(session.sessionId, session);
      notify(session, null);
      return session;
    },
    get(sessionId) {
      return sessions.get(sessionId) || null;
    },
    require(sessionId) {
      const session = sessions.get(sessionId);
      if (!session) throw new Error(`Unknown view session: ${sessionId}`);
      return session;
    },
    update,
    updateViewport(sessionId, viewport) {
      return update(sessionId, () => ({ viewport }), { invalidateComputation: false });
    },
    close(sessionId) {
      const previous = sessions.get(sessionId);
      if (!previous) return false;
      sessions.delete(sessionId);
      notify(null, previous);
      return true;
    },
    closeByDocument(documentId) {
      const matching = [...sessions.values()].filter((session) => session.documentId === documentId);
      for (const session of matching) {
        sessions.delete(session.sessionId);
        notify(null, session);
      }
      return matching.length;
    },
    list() {
      return [...sessions.values()];
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  });
}
