export function createDocumentEnvelope(value) {
  const documentId = requiredString(value?.documentId, "documentId");
  const domainId = requiredString(value?.domainId, "domainId");
  const sourceRevision = positiveInteger(value?.sourceRevision ?? 1, "sourceRevision");
  if (value?.model === undefined || value?.model === null) {
    throw new Error("Document model is required");
  }
  return Object.freeze({
    documentId,
    domainId,
    sourceRevision,
    source: normalizeSourceSummary(value.source),
    model: value.model,
    diagnostics: Object.freeze([...(value.diagnostics || [])])
  });
}

export function isDocumentEnvelope(value) {
  try {
    createDocumentEnvelope(value);
    return true;
  } catch {
    return false;
  }
}

export function normalizeSourceInput(value) {
  if (!value || typeof value !== "object") throw new Error("Source input is required");
  const name = String(value.name || "input");
  if (typeof value.text === "string") {
    return { name, kind: "text", text: value.text, mediaType: value.mediaType || "text/plain" };
  }
  if (value.bytes instanceof Uint8Array) {
    return { name, kind: "bytes", bytes: value.bytes, mediaType: value.mediaType || "application/octet-stream" };
  }
  throw new Error("Source input must contain text or Uint8Array bytes");
}

function normalizeSourceSummary(value = {}) {
  return Object.freeze({
    name: String(value.name || "input"),
    kind: value.kind === "bytes" ? "bytes" : "text",
    mediaType: String(value.mediaType || "application/octet-stream"),
    size: Math.max(0, Number(value.size) || 0)
  });
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Document ${name} is required`);
  return value;
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`Document ${name} must be a positive integer`);
  return number;
}
