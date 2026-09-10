import { normalizeStartupManifest, STARTUP_MANIFEST_VERSION } from "../persistence/startup_codec.js";

export { normalizeStartupManifest, STARTUP_MANIFEST_VERSION };
export const STARTUP_MANIFEST_ENDPOINT = "./__ngb_startup__.json";

export async function fetchStartupManifest(search, fetchImpl = globalThis.fetch) {
  const parameters = new URLSearchParams(search || "");
  if (parameters.get("startup") !== "1") return null;
  const response = await fetchImpl(STARTUP_MANIFEST_ENDPOINT, { cache: "no-store" });
  if (!response.ok) throw new Error(`Startup manifest request failed: HTTP ${response.status}`);
  return normalizeStartupManifest(await response.json());
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
  if (Array.isArray(normalized.target.focus)) {
    if (handlers.focusCells) await handlers.focusCells(normalized.target.focus);
    else for (const focus of normalized.target.focus) await handlers.focusCell?.(focus);
  } else if (normalized.target.focus) {
    await handlers.focusCell?.(normalized.target.focus);
  }
  await handlers.ready?.(normalized);
  return normalized;
}

function capitalize(value) {
  return value[0].toUpperCase() + value.slice(1);
}
