export function createSourceIdentity(name, source) {
  const size = sourceSize(source);
  return Object.freeze({
    name: String(name || "source"),
    size,
    fingerprint: fingerprintSource(source)
  });
}

export function normalizeSourceIdentity(value, fallbackName = "source", fallbackSource = null) {
  const hasFallbackSource = typeof fallbackSource === "string" || fallbackSource instanceof Uint8Array;
  const fallback = hasFallbackSource
    ? createSourceIdentity(fallbackName, fallbackSource)
    : Object.freeze({ name: String(fallbackName || "source"), size: 0 });
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const size = Number(value.size);
  const fingerprint = typeof value.fingerprint === "string" && value.fingerprint
    ? value.fingerprint
    : hasFallbackSource ? fallback.fingerprint : null;
  return Object.freeze({
    name: String(value.name || fallback.name),
    size: Number.isInteger(size) && size >= 0 ? size : fallback.size,
    ...(fingerprint ? { fingerprint } : {})
  });
}

export function sourceIdentitiesMatch(left, right) {
  if (!left || !right) return true;
  if (left.fingerprint && right.fingerprint) return left.fingerprint === right.fingerprint;
  return left.name === right.name && (left.size === null || right.size === null || left.size === right.size);
}

function sourceSize(source) {
  if (source instanceof Uint8Array) return source.byteLength;
  return String(source || "").length;
}

function fingerprintSource(source) {
  let hash = 0x811c9dc5;
  if (source instanceof Uint8Array) {
    for (const value of source) hash = Math.imul(hash ^ value, 0x01000193);
  } else {
    const text = String(source || "");
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      hash = Math.imul(hash ^ (code & 0xff), 0x01000193);
      hash = Math.imul(hash ^ (code >>> 8), 0x01000193);
    }
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
