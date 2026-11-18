export const AIG_IMPORT_LIMITS = Object.freeze({ sourceCharacters: 16 * 1024 * 1024, objects: 100000, tokens: 2000000, nesting: 64, normalizationWork: 8000000 });

export function aigError(message, source = {}, location = {}, code = "aig.invalid-input") {
  const prefix = source.name || source.format || "AIG";
  const line = location.line || 0;
  const column = location.column || 0;
  const error = new Error(`${prefix}${line ? `:${line}${column ? `:${column}` : ""}` : ""}: ${message}`);
  error.name = "AigImportError";
  error.code = code;
  error.diagnostic = Object.freeze({ severity: "error", code, message, file: prefix, line, column, objectId: location.generatedFor || location.id || null,
    ...(Number.isInteger(location.inputCount) ? { inputCount: location.inputCount } : {}) });
  return error;
}

export function requireAig(condition, message, source, location, code) {
  if (!condition) throw aigError(message, source, location, code);
}

export function freezeAig(value) {
  const pending = [value];
  const seen = new Set();
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== "object" || seen.has(item)) continue;
    seen.add(item);
    for (const child of Object.values(item)) pending.push(child);
    Object.freeze(item);
  }
  return value;
}
