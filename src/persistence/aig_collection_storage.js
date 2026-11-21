import { createDomainWorkspaceStorage } from "./domain_workspace_storage.js";
import { createSourceIdentity } from "./source_identity.js";

const manifestKey = "ngb.aig-collection.v1";
const sourcePrefix = "ngb.aig-source.";
export const collectionLimits = Object.freeze({ graphs: 64, characters: 32 * 1024 * 1024 });

export function createAigCollectionStorage(readStorage) {
  const legacy = createDomainWorkspaceStorage(readStorage);
  const written = new Set();
  function discard() {
    const storage = readStorage();
    storage.removeItem(manifestKey);
    for (const key of Object.keys(storage)) if (key.startsWith(sourcePrefix)) storage.removeItem(key);
    written.clear();
  }
  function clear() {
    legacy.clear();
    discard();
  }
  function save(entries, activeId) {
    try {
      const active = entries.find((entry) => entry.id === activeId);
      if (entries.length === 1) {
        legacy.save({ ...active.view, domainId: "aig", graphId: active.id, source: active.source });
        if (readStorage().getItem(manifestKey)) discard();
        return;
      }
      const storage = readStorage();
      const records = entries.map(({ id, source, view, identity }) => {
        if (!written.has(id)) {
          storage.setItem(sourcePrefix + id, JSON.stringify(source));
          written.add(id);
        }
        return { id, identity, view };
      });
      storage.setItem(manifestKey, JSON.stringify({ version: 3, activeId, records }));
      legacy.clear();
      const live = new Set(entries.map((entry) => entry.id));
      for (const id of written) if (!live.has(id)) {
        storage.removeItem(sourcePrefix + id);
        written.delete(id);
      }
    } catch (error) {
      try { clear(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Collection persistence failed", { cause: error }); }
      throw error;
    }
  }
  function load() {
    const storage = readStorage();
    const raw = storage.getItem(manifestKey);
    if (!raw) {
      const saved = legacy.load();
      if (!saved) return null;
      const { source, graphId, ...view } = saved;
      const id = /^g[1-9][0-9]*$/.test(graphId) ? graphId : "g1";
      return { activeId: id, entries: [{ id, source, view }] };
    }
    const manifest = JSON.parse(raw);
    if (manifest.version !== 3 || !Array.isArray(manifest.records) || manifest.records.length > collectionLimits.graphs)
      throw new Error("Invalid AIG collection manifest");
    let characters = 0;
    const entries = manifest.records.map(({ id, view, identity }) => {
      if (!/^g[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id.slice(1)))) throw new Error("Invalid archived graph ID");
      const source = JSON.parse(storage.getItem(sourcePrefix + id));
      if (!source || typeof source.text !== "string" || createSourceIdentity(source.name, source.text).fingerprint !== identity.fingerprint)
        throw new Error("AIG collection source mismatch: " + id);
      characters += source.text.length;
      if (characters > collectionLimits.characters) throw new Error("Archived AIG sources exceed the collection limit");
      return { id, source, view, identity };
    });
    if (new Set(entries.map((item) => item.id)).size !== entries.length || !entries.some((item) => item.id === manifest.activeId))
      throw new Error("Invalid active graph in collection");
    for (const {id} of entries) written.add(id);
    return { entries, activeId: manifest.activeId };
  }
  return { load, save, clear };
}
