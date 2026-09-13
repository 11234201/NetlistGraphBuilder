export function createJobCoordinator({ documents, sessions, artifacts }) {
  const activeByKey = new Map();
  let nextJobId = 1;

  function start({ sessionId, kind, run, onProgress = () => {} }) {
    if (typeof run !== "function") throw new Error("Job run function is required");
    const session = sessions.require(sessionId);
    const document = documents.require(session.documentId);
    const key = jobKey(sessionId, kind);
    activeByKey.get(key)?.controller.abort();
    const controller = new AbortController();
    const context = createContext({ document, session, sessionId, kind, controller, onProgress });
    activeByKey.set(key, { context, controller });

    const promise = Promise.resolve().then(() => run(context)).then(
      (value) => {
        if (!isCurrent(context)) {
          release(context);
          return Object.freeze({ status: "stale", context });
        }
        release(context);
        const artifact = artifacts.put({ kind, context, value });
        return Object.freeze({ status: "committed", context, artifact });
      },
      (error) => {
        if (!isCurrent(context)) {
          release(context);
          return Object.freeze({ status: "stale", context, error });
        }
        release(context);
        throw error;
      }
    );
    return Object.freeze({ context, promise, cancel: () => cancelContext(context) });
  }

  function runSync({ sessionId, kind, run, onProgress = () => {} }) {
    if (typeof run !== "function") throw new Error("Job run function is required");
    const session = sessions.require(sessionId);
    const document = documents.require(session.documentId);
    const key = jobKey(sessionId, kind);
    activeByKey.get(key)?.controller.abort();
    const controller = new AbortController();
    const context = createContext({ document, session, sessionId, kind, controller, onProgress });
    activeByKey.set(key, { context, controller });
    try {
      const value = run(context);
      if (value && typeof value.then === "function") {
        throw new Error(`Synchronous job ${kind} returned a Promise`);
      }
      if (!isCurrent(context)) {
        release(context);
        return Object.freeze({ status: "stale", context });
      }
      release(context);
      const artifact = artifacts.put({ kind, context, value });
      return Object.freeze({ status: "committed", context, artifact });
    } catch (error) {
      release(context);
      throw error;
    }
  }

  function isCurrent(context) {
    const active = activeByKey.get(jobKey(context.sessionId, context.kind));
    if (active?.context !== context) return false;
    const session = sessions.get(context.sessionId);
    const document = documents.get(context.documentId);
    return Boolean(session && document && !context.signal.aborted &&
      session.documentId === context.documentId &&
      session.computationRevision === context.computationRevision &&
      document.sourceRevision === context.sourceRevision);
  }

  function cancelContext(context) {
    const key = jobKey(context.sessionId, context.kind);
    const active = activeByKey.get(key);
    if (active?.context !== context) return false;
    active.controller.abort();
    activeByKey.delete(key);
    return true;
  }

  function release(context) {
    const key = jobKey(context.sessionId, context.kind);
    if (activeByKey.get(key)?.context === context) activeByKey.delete(key);
  }

  function cancelSession(sessionId) {
    let cancelled = 0;
    for (const [key, active] of activeByKey) {
      if (active.context.sessionId !== sessionId) continue;
      active.controller.abort();
      activeByKey.delete(key);
      cancelled += 1;
    }
    artifacts.clearSession(sessionId);
    return cancelled;
  }

  function cancelDocument(documentId) {
    let cancelled = 0;
    for (const [key, active] of activeByKey) {
      if (active.context.documentId !== documentId) continue;
      active.controller.abort();
      activeByKey.delete(key);
      cancelled += 1;
    }
    artifacts.clearDocument(documentId);
    return cancelled;
  }

  function createContext({ document, session, sessionId, kind, controller, onProgress }) {
    let context;
    context = Object.freeze({
      documentId: document.documentId,
      sourceRevision: document.sourceRevision,
      sessionId,
      sessionRevision: session.sessionRevision,
      computationRevision: session.computationRevision,
      kind,
      jobId: `job:${nextJobId++}`,
      signal: controller.signal,
      reportProgress(value) {
        if (isCurrent(context)) onProgress(value, context);
      }
    });
    return context;
  }

  return Object.freeze({ start, runSync, isCurrent, cancelSession, cancelDocument });
}

function jobKey(sessionId, kind) {
  if (!sessionId || !kind) throw new Error("Job sessionId and kind are required");
  return `${encodeURIComponent(sessionId)}/${encodeURIComponent(kind)}`;
}
