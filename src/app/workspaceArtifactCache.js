/**
 * Small bounded cache for derived workspace artifacts. Graph and scene objects
 * are treated as immutable after publication; callers own any mutable overlays.
 */
const artifactReferences = new WeakMap();
let nextArtifactReference = 1;

// Published graphs/providers are immutable dependencies, not serialized graph content.
export function workspaceArtifactReference(value) {
  if (!value || typeof value !== "object") return null;
  if (!artifactReferences.has(value)) artifactReferences.set(value, nextArtifactReference++);
  return artifactReferences.get(value);
}

export function createWorkspaceArtifactCache({ capacity = 24, maximumWeight = 250000 } = {}) {
  const limit = normalizeCapacity(capacity);
  const weightLimit = normalizeCapacity(maximumWeight);
  const entries = new Map();
  let totalWeight = 0;
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
    const weight = normalizeWeight(metadata.weight ?? estimateArtifactWeight(value));
    if (entries.has(normalized)) totalWeight -= entries.get(normalized).weight;
    entries.delete(normalized);
    if (weight > weightLimit) return value;
    entries.set(normalized, { value, metadata: { ...metadata }, weight });
    totalWeight += weight;
    while (entries.size > limit || totalWeight > weightLimit) {
      const oldestKey = entries.keys().next().value;
      totalWeight -= entries.get(oldestKey).weight;
      entries.delete(oldestKey);
      evictions += 1;
    }
    return value;
  }

  function clear() {
    entries.clear();
    totalWeight = 0;
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
      totalWeight -= record.weight;
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
    stats: () => ({ hits, misses, evictions, size: entries.size, capacity: limit, weight: totalWeight, maximumWeight: weightLimit }),
    keys: () => [...entries.keys()]
  });
}

export function createWorkspaceArtifactKey(identity) {
  return stableSerialize(identity);
}

function normalizeKey(key) {
  return typeof key === "string" ? key : createWorkspaceArtifactKey(key);
}

function stableSerialize(value, seen = new WeakSet()) {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "number:NaN";
    if (Object.is(value, -0)) return "number:-0";
    return `number:${value}`;
  }
  if (["symbol", "function", "bigint"].includes(typeof value)) {
    throw new TypeError(`Unsupported workspace artifact identity type: ${typeof value}`);
  }
  if (typeof value !== "object") return `${typeof value}:${JSON.stringify(value)}`;
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
    result = `[${Array.from({ length: value.length }, (_, index) =>
      Object.hasOwn(value, index) ? stableSerialize(value[index], seen) : "hole").join(",")}]`;
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Workspace artifact identity requires plain records, arrays, Maps or Sets");
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError("Workspace artifact identity does not support Symbol properties");
    }
    result = `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key], seen)}`).join(",")}}`;
  }
  seen.delete(value);
  return result;
}

function estimateArtifactWeight(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return 1;
  if (typeof value === "string") return Math.max(1, Math.ceil(value.length / 32));
  if (typeof value !== "object" || seen.has(value)) return 1;
  seen.add(value);
  if (Array.isArray(value)) return 1 + value.reduce((sum, item) => sum + estimateArtifactWeight(item, seen), 0);
  if (value instanceof Map || value instanceof Set) {
    let weight = 1;
    if (value instanceof Map) {
      for (const [key, item] of value) {
        weight += estimateArtifactWeight(key, seen);
        weight += estimateArtifactWeight(item, seen);
      }
    } else {
      for (const item of value) weight += estimateArtifactWeight(item, seen);
    }
    return weight;
  }
  let weight = 1;
  for (const item of Object.values(value)) weight += estimateArtifactWeight(item, seen);
  return weight;
}

function normalizeWeight(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.ceil(number)) : 1;
}

function normalizeCapacity(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.floor(number)) : 24;
}
