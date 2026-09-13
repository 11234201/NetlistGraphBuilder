import { createObjectRef, isObjectRef, objectRefKey } from "../contracts/object_ref.js";

const VIEW_MODES = new Set(["whole", "focused", "search-first"]);

function requireId(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} is required`);
  return value;
}

export function createViewSession(value) {
  const documentId = requireId(value?.documentId, "View documentId");
  const unitId = requireId(value?.unitId, "View unitId");
  const focusedRootRefs = normalizeRefs(value.focusedRootRefs, documentId, unitId, "focusedRootRefs");
  const activeFocusedRootRef = normalizeRef(value.activeFocusedRootRef, documentId, unitId, "activeFocusedRootRef");
  const selectedObjectRef = normalizeRef(value.selectedObjectRef, documentId, unitId, "selectedObjectRef");
  if (activeFocusedRootRef && !focusedRootRefs.some((ref) => objectRefKey(ref) === objectRefKey(activeFocusedRootRef))) {
    throw new Error("View activeFocusedRootRef must be one of focusedRootRefs");
  }
  return Object.freeze({
    sessionId: requireId(value?.sessionId, "View sessionId"),
    documentId,
    domainId: requireId(value?.domainId, "View domainId"),
    unitId,
    sessionRevision: normalizeRevision(value.sessionRevision, "sessionRevision"),
    computationRevision: normalizeRevision(value.computationRevision, "computationRevision"),
    viewMode: normalizeViewMode(value.viewMode),
    faninDepth: normalizeDepth(value.faninDepth, 3),
    fanoutDepth: normalizeDepth(value.fanoutDepth, 3),
    focusedRootRefs,
    activeFocusedRootRef,
    selectedObjectRef,
    layoutPolicy: normalizeRecord(value.layoutPolicy, "layoutPolicy"),
    presentationPolicy: normalizeRecord(value.presentationPolicy, "presentationPolicy"),
    overrides: value.overrides || null,
    viewport: normalizeViewport(value.viewport)
  });
}

function normalizeDepth(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("View depth must be finite");
  return Math.min(99, Math.max(0, Math.floor(number)));
}

export function createViewSessionStore(initialSessions = []) {
  const sessions = new Map();
  for (const value of initialSessions) {
    const session = createViewSession(value);
    if (sessions.has(session.sessionId)) throw new Error(`Duplicate view session: ${session.sessionId}`);
    sessions.set(session.sessionId, session);
  }
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
    if (next.sessionId !== previous.sessionId || next.documentId !== previous.documentId || next.domainId !== previous.domainId) {
      throw new Error("View session identity cannot change during update");
    }
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
      const previous = sessions.get(sessionId);
      if (!previous) throw new Error(`Unknown view session: ${sessionId}`);
      const normalized = normalizeViewport(viewport);
      return sameViewport(previous.viewport, normalized)
        ? previous
        : update(sessionId, () => ({ viewport: normalized }), { invalidateComputation: false });
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
      if (typeof listener !== "function") throw new Error("View session listener must be a function");
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  });
}

function normalizeRevision(value, label) {
  if (value === undefined || value === null) return 1;
  if (!Number.isInteger(value) || value < 1) throw new Error(`View ${label} must be a positive integer`);
  return value;
}

function normalizeViewMode(value) {
  const mode = value || "whole";
  if (!VIEW_MODES.has(mode)) throw new Error(`View mode is unsupported: ${mode}`);
  return mode;
}

function normalizeRefs(values, documentId, unitId, label) {
  if (values !== undefined && !Array.isArray(values)) throw new Error(`View ${label} must be an array`);
  const refs = (values || []).map((value) => normalizeRef(value, documentId, unitId, label));
  const keys = refs.map(objectRefKey);
  if (new Set(keys).size !== keys.length) throw new Error(`View ${label} must not contain duplicates`);
  return Object.freeze(refs);
}

function normalizeRef(value, documentId, unitId, label) {
  if (value === undefined || value === null) return null;
  if (!isObjectRef(value)) throw new Error(`View ${label} must contain ObjectRef values`);
  const ref = createObjectRef(value);
  if (ref.documentId !== documentId || ref.unitId !== unitId) {
    throw new Error(`View ${label} belongs to another document or unit`);
  }
  return ref;
}

function normalizeRecord(value, label) {
  const record = value ?? {};
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error(`View ${label} must be an object`);
  }
  return Object.freeze({ ...record });
}

function normalizeViewport(value) {
  const source = value || { x: 0, y: 0, scale: 1 };
  const viewport = { x: Number(source.x), y: Number(source.y), scale: Number(source.scale) };
  if (!Object.values(viewport).every(Number.isFinite) || viewport.scale <= 0) {
    throw new Error("View viewport must be finite with a positive scale");
  }
  return Object.freeze(viewport);
}

function sameViewport(left, right) {
  return left.x === right.x && left.y === right.y && left.scale === right.scale;
}
