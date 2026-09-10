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
  const normalized = [...new Set(values
    .filter((item) => item !== undefined && item !== null && String(item).trim())
    .map((item) => String(item)))];
  if (normalized.length === 0) throw new Error("Startup target.focus must contain a cell identifier");
  return Array.isArray(value) ? normalized : normalized[0];
}

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
