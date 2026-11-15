const STORAGE_KEY = "ngb.domain-workspace.v1";

export function encodeDomainWorkspace({ domainId, source, viewport, selectedId, presentationPolicy, panels }) {
  if (!domainId || typeof source?.text !== "string") throw new Error("Workspace source is required");
  return JSON.stringify({ kind: "domain-workspace", version: 1, normalizationVersion: 1,
    domainId, source: { name: String(source.name || "input"), format: source.format, text: source.text },
    viewport, selectedId: selectedId || null, presentationPolicy, panels });
}

export function decodeDomainWorkspace(text) {
  if (!text) return null;
  const value = JSON.parse(text);
  if (value?.kind !== "domain-workspace" || value.version !== 1 || value.normalizationVersion !== 1 ||
      typeof value.domainId !== "string" || typeof value.source?.text !== "string") {
    throw new Error("Unsupported domain workspace archive");
  }
  return value;
}

export function createDomainWorkspaceStorage(storage) {
  const readStorage = typeof storage === "function" ? storage : () => storage;
  return Object.freeze({
    load: () => decodeDomainWorkspace(readStorage().getItem(STORAGE_KEY)),
    save(value) {
      const target = readStorage();
      try { target.setItem(STORAGE_KEY, encodeDomainWorkspace(value)); }
      catch (error) {
        // A failed replacement must not restore the previous document on reload.
        try { target.removeItem(STORAGE_KEY); }
        catch (cleanupError) {
          throw new AggregateError([error, cleanupError],
            `Workspace save failed: ${error.message}; previous archive cleanup failed: ${cleanupError.message}`, { cause: error });
        }
        throw error;
      }
    },
    clear: () => readStorage().removeItem(STORAGE_KEY)
  });
}
