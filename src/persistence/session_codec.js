export const SESSION_CODEC_VERSION = 2;

export function encodeSessionSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") throw new Error("Session snapshot is required");
  return JSON.stringify({ ...snapshot, version: SESSION_CODEC_VERSION });
}

export function decodeSessionSnapshot(value) {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch (error) {
      throw new Error(`Invalid session JSON: ${error.message}`);
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Session snapshot must be an object");
  }
  if (parsed.version === 1) return migrateVersion1(parsed);
  if (parsed.version !== SESSION_CODEC_VERSION) {
    throw new Error(`Unsupported session version: ${parsed.version ?? "missing"}`);
  }
  return normalizeVersion2(parsed);
}

function migrateVersion1(value) {
  return normalizeVersion2({
    ...value,
    version: SESSION_CODEC_VERSION,
    domainId: "netlist",
    documentId: null,
    unitId: value.moduleName || null,
    sourceIdentity: createSourceIdentity(value.sourceLabel, value.source)
  });
}

function normalizeVersion2(value) {
  return {
    ...value,
    version: SESSION_CODEC_VERSION,
    domainId: typeof value.domainId === "string" && value.domainId ? value.domainId : "netlist",
    documentId: optionalString(value.documentId),
    unitId: optionalString(value.unitId || value.moduleName),
    sourceIdentity: normalizeSourceIdentity(value.sourceIdentity, value.sourceLabel, value.source)
  };
}

function normalizeSourceIdentity(value, sourceLabel, source) {
  if (value && typeof value === "object") {
    return Object.freeze({
      name: String(value.name || sourceLabel || "source"),
      size: nonNegativeInteger(value.size, String(source || "").length)
    });
  }
  return createSourceIdentity(sourceLabel, source);
}

function createSourceIdentity(label, source) {
  return Object.freeze({ name: String(label || "source"), size: String(source || "").length });
}

function optionalString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}
