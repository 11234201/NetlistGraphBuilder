import { normalizeStartupManifest, STARTUP_MANIFEST_VERSION } from "../persistence/startup_codec.js";

export { normalizeStartupManifest, STARTUP_MANIFEST_VERSION };
export const STARTUP_MANIFEST_ENDPOINT = "./__ngb_startup__.json";

export async function fetchStartupManifest(search, fetchImpl = globalThis.fetch, { signal } = {}) {
  const parameters = new URLSearchParams(search || "");
  if (parameters.get("startup") !== "1") return null;
  const response = await fetchImpl(STARTUP_MANIFEST_ENDPOINT, { cache: "no-store", ...(signal ? { signal } : {}) });
  if (!response.ok) throw new Error(`Startup manifest request failed: HTTP ${response.status}`);
  return normalizeStartupManifest(await response.json());
}

export async function executeStartupManifest(manifest, handlers, { signal } = {}) {
  const normalized = normalizeStartupManifest(manifest);
  const invoke = (name, ...args) => {
    if (signal?.aborted) throw Object.assign(new Error("Startup import cancelled"), { name: "AbortError" });
    return handlers[name]?.(...args);
  };
  await invoke("configureTarget", normalized.target);
  for (const kind of ["cellConfig", "netlist"]) {
    const input = normalized.inputs[kind];
    if (input) await invoke(`load${capitalize(kind)}`, input, normalized.target);
  }
  await invoke("ensureDesign", normalized.target);
  if (normalized.inputs.timing) await invoke("loadTiming", normalized.inputs.timing, normalized.target);
  if (normalized.target.module) await invoke("selectModule", normalized.target.module);
  if (Array.isArray(normalized.target.focus)) {
    if (handlers.focusCells) await invoke("focusCells", normalized.target.focus);
    else for (const focus of normalized.target.focus) await invoke("focusCell", focus);
  } else if (normalized.target.focus) {
    await invoke("focusCell", normalized.target.focus);
  }
  await invoke("ready", normalized);
  return normalized;
}

function capitalize(value) {
  return value[0].toUpperCase() + value.slice(1);
}
