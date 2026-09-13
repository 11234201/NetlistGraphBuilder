/**
 * Small bounded cache for derived workspace artifacts. Graph and scene objects
 * are treated as immutable after publication; callers own any mutable overlays.
 */
export function createWorkspaceArtifactCache({ capacity = 24 } = {}) {
  const limit = normalizeCapacity(capacity);
  const entries = new Map();
  let hits = 0;
  let misses = 0;
  let evictions = 0;

  function get(key) {
    const normalized = normalizeKey(key);
    if (!entries.has(normalized)) {
      misses += 1;
      return null;
    }
    const record = entries.get(normalized);
    entries.delete(normalized);
    entries.set(normalized, record);
    hits += 1;
    return record.value;
  }

  function put(key, value, metadata = {}) {
    const normalized = normalizeKey(key);
    entries.delete(normalized);
    entries.set(normalized, { value, metadata: { ...metadata } });
    while (entries.size > limit) {
      entries.delete(entries.keys().next().value);
      evictions += 1;
    }
    return value;
  }

  function clear() {
    entries.clear();
  }

  function clearDocument(documentId) {
    return clearMatching((record) => record.metadata.documentId === documentId);
  }

  function clearSession(sessionId) {
    return clearMatching((record) => record.metadata.sessionId === sessionId);
  }

  function clearMatching(predicate) {
    let removed = 0;
    for (const [key, record] of entries) {
      if (!predicate(record)) continue;
      entries.delete(key);
      removed += 1;
    }
    return removed;
  }

  return Object.freeze({
    get,
    put,
    clear,
    clearDocument,
    clearSession,
    size: () => entries.size,
    stats: () => ({ hits, misses, evictions, size: entries.size, capacity: limit }),
    keys: () => [...entries.keys()]
  });
}

export function createWorkspaceArtifactKey(identity) {
  return stableSerialize(identity || {});
}

function normalizeKey(key) {
  return typeof key === "string" ? key : createWorkspaceArtifactKey(key);
}

function stableSerialize(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (seen.has(value)) throw new Error("Workspace artifact identity must be acyclic");
  seen.add(value);
  let result;
  if (value instanceof Map) {
    result = `map:[${[...value.entries()]
      .map(([key, item]) => [stableSerialize(key, seen), stableSerialize(item, seen)])
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([key, item]) => `[${key},${item}]`).join(",")}]`;
  } else if (value instanceof Set) {
    result = `set:[${[...value].map((item) => stableSerialize(item, seen)).sort().join(",")}]`;
  } else if (Array.isArray(value)) {
    result = `[${value.map((item) => stableSerialize(item, seen)).join(",")}]`;
  } else {
    result = `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key], seen)}`).join(",")}}`;
  }
  seen.delete(value);
  return result;
}

function normalizeCapacity(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.floor(number)) : 24;
}
