import { createSourceIdentity, normalizeSourceIdentity } from "./source_identity.js";
import { isObjectRef } from "../contracts/object_ref.js";

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
    sourceIdentity: normalizeSourceIdentity(value.sourceIdentity, value.sourceLabel, value.source),
    presentationPolicy: normalizePresentationPolicy(value.presentationPolicy),
    focusedRootRefs: normalizeFocusedRootRefs(value.focusedRootRefs)
  };
}

function normalizePresentationPolicy(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    gateSymbolMode: source.gateSymbolMode === "conventional" ? "conventional" : "rectangle"
  };
}

function optionalString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeFocusedRootRefs(value) {
  return (Array.isArray(value) ? value : [])
    .filter((ref) => isObjectRef(ref))
    .map((ref) => ({
      ...ref,
      ...(Array.isArray(ref.occurrencePath) ? { occurrencePath: [...ref.occurrencePath] } : {})
    }));
}
