import { createDomainWorkspaceStorage } from "./domain_workspace_storage.js";
import { createSourceIdentity } from "./source_identity.js";

const manifestKey = "ngb.aig-collection.v1";
const sourcePrefix = "ngb.aig-source.";
export const collectionLimits = Object.freeze({ graphs: 64, characters: 32 * 1024 * 1024 });

export function aigSourceCharacters(source) {
  if (source.levelFile !== undefined && (!source.levelFile || typeof source.levelFile.name !== "string" || typeof source.levelFile.text !== "string"))
    throw new Error("Invalid AIG Level attachment");
  return source.text.length + (source.levelFile?.text.length || 0);
}

export function createAigCollectionStorage(readStorage) {
  const legacy = createDomainWorkspaceStorage(readStorage);
  const written = new Map();
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
      const storage = readStorage();
      const active = entries.find((entry) => entry.id === activeId);
      // Annotated graphs use the separate source record even as singletons so
      // saving a viewport never serializes the design and its Level file again.
      if (entries.length === 1 && !active.source.levelFile) {
        if (storage.getItem(manifestKey)) discard();
        legacy.save({ ...active.view, domainId: "aig", graphId: active.id, source: active.source });
        return;
      }
      // Reclaim the old representation before writing the design again.
      legacy.clear();
      if (!written.size && storage.getItem(manifestKey)) discard();
      const live = new Set(entries.map((entry) => entry.id));
      for (const id of written.keys()) if (!live.has(id)) {
        storage.removeItem(sourcePrefix + id);
        written.delete(id);
      }
      const records = entries.map(({ id, source, view, identity }) => {
        if (written.get(id) !== source) {
          storage.setItem(sourcePrefix + id, JSON.stringify(source));
          written.set(id, source);
        }
        return { id, identity, view };
      });
      storage.setItem(manifestKey, JSON.stringify({ version: 3, activeId, records }));
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
      if (aigSourceCharacters(source) > collectionLimits.characters) throw new Error("Archived AIG sources exceed the collection limit");
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
      characters += aigSourceCharacters(source);
      if (characters > collectionLimits.characters) throw new Error("Archived AIG sources exceed the collection limit");
      return { id, source, view, identity };
    });
    if (new Set(entries.map((item) => item.id)).size !== entries.length || !entries.some((item) => item.id === manifest.activeId))
      throw new Error("Invalid active graph in collection");
    for (const { id, source } of entries) written.set(id, source);
    return { entries, activeId: manifest.activeId };
  }
  return { load, save, clear };
}
