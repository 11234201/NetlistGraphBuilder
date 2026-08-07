export const STARTUP_MANIFEST_VERSION = 1;
export const STARTUP_MANIFEST_ENDPOINT = "./__ngb_startup__.json";

export async function fetchStartupManifest(search, fetchImpl = globalThis.fetch) {
  const parameters = new URLSearchParams(search || "");
  if (parameters.get("startup") !== "1") return null;
  const response = await fetchImpl(STARTUP_MANIFEST_ENDPOINT, { cache: "no-store" });
  if (!response.ok) throw new Error(`Startup manifest request failed: HTTP ${response.status}`);
  return normalizeStartupManifest(await response.json());
}

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
      ...(target.focus === undefined ? {} : { focus: String(target.focus) }),
      ...(target.faninDepth === undefined ? {} : { faninDepth: normalizeDepth(target.faninDepth, "faninDepth") }),
      ...(target.fanoutDepth === undefined ? {} : { fanoutDepth: normalizeDepth(target.fanoutDepth, "fanoutDepth") })
    }
  };
}

export async function executeStartupManifest(manifest, handlers) {
  const normalized = normalizeStartupManifest(manifest);
  await handlers.configureTarget?.(normalized.target);
  for (const kind of ["cellConfig", "netlist"]) {
    const input = normalized.inputs[kind];
    if (input) await handlers[`load${capitalize(kind)}`]?.(input, normalized.target);
  }
  await handlers.ensureDesign?.(normalized.target);
  if (normalized.inputs.timing) await handlers.loadTiming?.(normalized.inputs.timing, normalized.target);
  if (normalized.target.module) await handlers.selectModule?.(normalized.target.module);
  if (normalized.target.focus) await handlers.focusCell?.(normalized.target.focus);
  await handlers.ready?.(normalized);
  return normalized;
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

function capitalize(value) {
  return value[0].toUpperCase() + value.slice(1);
}

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
