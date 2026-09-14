export const STARTUP_MANIFEST_VERSION = 1;

export function normalizeStartupManifest(value) {
  if (!isObject(value)) throw new Error("Startup manifest must be an object");
  if (value.version !== STARTUP_MANIFEST_VERSION) {
    throw new Error(`Unsupported startup manifest version: ${value.version}`);
  }
  const inputs = isObject(value.inputs) ? value.inputs : {};
  const target = isObject(value.target) ? value.target : {};
  return {
    version: STARTUP_MANIFEST_VERSION,
    inputs: Object.fromEntries(["cellConfig", "netlist", "timing"]
      .filter((kind) => inputs[kind] !== undefined)
      .map((kind) => [kind, normalizeInput(inputs[kind], kind)])),
    target: {
      ...(target.module === undefined ? {} : { module: String(target.module) }),
      ...(target.focus === undefined ? {} : { focus: normalizeFocusTargets(target.focus) }),
      ...(target.faninDepth === undefined ? {} : { faninDepth: normalizeDepth(target.faninDepth, "faninDepth") }),
      ...(target.fanoutDepth === undefined ? {} : { fanoutDepth: normalizeDepth(target.fanoutDepth, "fanoutDepth") })
    }
  };
}

function normalizeInput(value, kind) {
  if (!isObject(value) || typeof value.text !== "string") {
    throw new Error(`Startup ${kind} input must contain text`);
  }
  return { name: String(value.name || kind), text: value.text };
}

function normalizeDepth(value, label) {
  const depth = Number(value);
  if (!Number.isInteger(depth) || depth < 0 || depth > 99) {
    throw new Error(`Startup ${label} must be an integer from 0 to 99`);
  }
  return depth;
}

function normalizeFocusTargets(value) {
  const values = Array.isArray(value) ? value : [value];
  const normalized = [];
  const seen = new Set();
  for (const item of values) {
    if (item === undefined || item === null) continue;
    const target = normalizeFocusTarget(item);
    const key = typeof target === "string"
      ? `cell:${target}`
      : `${target.kind}:${target.localId}:${(target.occurrencePath || []).join("/")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(target);
  }
  if (normalized.length === 0) throw new Error("Startup target.focus must contain a cell identifier");
  return Array.isArray(value) ? normalized : normalized[0];
}

function normalizeFocusTarget(value) {
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) throw new Error("Startup target.focus must contain a cell identifier");
    return normalized;
  }
  if (!isObject(value)) throw new Error("Startup target.focus must contain a cell identifier or ObjectRef");
  const kind = value.kind === "net" ? "net" : value.kind === "cell" ? "cell" : null;
  const localId = typeof value.localId === "string" && value.localId.trim()
    ? value.localId.trim()
    : typeof value.name === "string" && value.name.trim()
      ? value.name.trim() : null;
  if (!kind || !localId) throw new Error("Startup target.focus ObjectRef requires kind and localId");
  const target = { kind, localId };
  if (value.documentId !== undefined) {
    if (typeof value.documentId !== "string" || !value.documentId) {
      throw new Error("Startup target.focus documentId must be a non-empty string");
    }
    target.documentId = value.documentId;
  }
  if (value.unitId !== undefined) {
    if (typeof value.unitId !== "string" || !value.unitId) {
      throw new Error("Startup target.focus unitId must be a non-empty string");
    }
    target.unitId = value.unitId;
  }
  if (value.rootModuleName !== undefined) {
    if (typeof value.rootModuleName !== "string" || !value.rootModuleName) {
      throw new Error("Startup target.focus rootModuleName must be a non-empty string");
    }
    target.rootModuleName = value.rootModuleName;
  }
  if (value.occurrencePath !== undefined) {
    if (!Array.isArray(value.occurrencePath) || value.occurrencePath.some((segment) => typeof segment !== "string" || !segment)) {
      throw new Error("Startup target.focus occurrencePath must contain non-empty strings");
    }
    target.occurrencePath = [...value.occurrencePath];
  }
  return target;
}

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
