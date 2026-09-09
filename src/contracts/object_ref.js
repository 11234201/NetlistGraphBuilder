export function createObjectRef(value) {
  const documentId = requiredId(value?.documentId, "documentId");
  const unitId = requiredId(value?.unitId, "unitId");
  const kind = requiredId(value?.kind, "kind");
  const localId = requiredId(value?.localId, "localId");
  const terminalId = optionalId(value?.terminalId, "terminalId");
  return Object.freeze({
    documentId,
    unitId,
    kind,
    localId,
    ...(terminalId === null ? {} : { terminalId })
  });
}

export function isObjectRef(value) {
  try {
    createObjectRef(value);
    return true;
  } catch {
    return false;
  }
}

export function objectRefKey(value) {
  const ref = createObjectRef(value);
  return [ref.documentId, ref.unitId, ref.kind, ref.localId, ref.terminalId || ""]
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function requiredId(value, name) {
  const normalized = optionalId(value, name);
  if (normalized === null) throw new Error(`ObjectRef ${name} is required`);
  return normalized;
}

function optionalId(value, name) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`ObjectRef ${name} must be a non-empty string`);
  }
  return value;
}
