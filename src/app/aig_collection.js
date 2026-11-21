import { collectionLimits } from "../persistence/aig_collection_storage.js";
import { createSourceIdentity } from "../persistence/source_identity.js";

export function createAigCollection({ validate, activate, render }) {
  let entries = [], activeId = null, serial = 0, pendingBatch = null;
  const list = () => entries.map(({ id, source, identity }) => ({
    id, name:source.name, format:source.format, fingerprint:identity.fingerprint, active:id === activeId
  }));
  function make(source) {
    return { id: "g" + ++serial, source, identity: createSourceIdentity(source.name, source.text), view: {} };
  }
  function changed() { render(list(), activeId); }
  function commit(source, id, request) {
    if (id) {
      activeId = id;
    } else {
      const batch = pendingBatch;
      const acceptingBatch = batch && (!request || batch.request === request) &&
        source.name === batch.first.name && source.text === batch.first.text && !batch.request.signal.aborted;
      entries = acceptingBatch ? batch.entries : [make(source)];
      activeId = entries[0].id;
      if (acceptingBatch) batch.result = { added:list(), activeGraphId:activeId, graphCount:entries.length };
    }
    changed();
  }
  function restore(saved) {
    entries = saved.entries.map((entry) => ({ ...entry, identity: entry.identity || createSourceIdentity(entry.source.name, entry.source.text) }));
    activeId = saved.activeId;
    serial = Math.max(serial, ...entries.map(({ id }) => Number(id.slice(1))));
    return entries.find((entry) => entry.id === activeId);
  }
  async function switchTo(key, request) {
    const exact = entries.find((entry) => entry.id === key);
    const matches = exact ? [exact] : entries.filter((entry) => entry.source.name === key);
    if (matches.length !== 1) throw Object.assign(new Error(matches.length ? "Ambiguous graph name" : "Graph not found"), {
      code: matches.length ? "AMBIGUOUS_GRAPH" : "GRAPH_NOT_FOUND", candidates: matches.map(({ id }) => id) });
    const entry = matches[0];
    if (entry.id !== activeId) await activate(entry.source, { ...entry.view, graphId: entry.id }, request);
    return list().find((item) => item.id === entry.id);
  }
  async function add(inputs, request) {
    request.signal.throwIfAborted();
    if (!inputs.length) throw new Error("Choose at least one AIG");
    const fileResults = failedIndex => inputs.map((source, index) => ({
      name:source.name, status:index === failedIndex ? "failed" : "uncommitted"
    }));
    let characters = entries.reduce((sum, entry) => sum + entry.source.text.length, 0);
    for (const [index, input] of inputs.entries()) {
      characters += input.text.length;
      if (entries.length + index + 1 > collectionLimits.graphs || characters > collectionLimits.characters)
        throw Object.assign(new Error("AIG collection capacity exceeded"), { code:"COLLECTION_LIMIT", files:fileResults(index) });
    }
    const validated = [];
    for (const [index, input] of inputs.entries()) {
      try {
        request.signal.throwIfAborted();
        const format = validate(input);
        validated.push(typeof format === "string" ? { ...input, format } : input);
      }
      catch (error) {
        error.files = fileResults(index);
        throw error;
      }
    }
    const oldLength = entries.length;
    request.signal.throwIfAborted();
    const stagedEntries = validated.map(make);
    if (!oldLength) {
      // Opening the first graph also installs the rest of its validated batch.
      // The renderer and persistence never observe an intermediate collection.
      const batch = { first:validated[0], entries:stagedEntries, request };
      pendingBatch = batch;
      try {
        await activate(batch.first, null, request);
        if (!batch.result) throw new DOMException("AIG import superseded", "AbortError");
        return batch.result;
      } catch (error) {
        if (!request.signal.aborted && error.name !== "AbortError") error.files = fileResults(0);
        throw error;
      } finally { if (pendingBatch === batch) pendingBatch = null; }
    }
    entries.push(...stagedEntries);
    changed();
    return { added: list().slice(oldLength), activeGraphId: activeId, graphCount: entries.length };
  }
  return { add, commit, restore, list, switchTo, active: () => activeId,
    clear() { entries = []; activeId = null; changed(); },
    save(view, storage) {
      const active = entries.find((entry) => entry.id === activeId);
      if (!active) return;
      active.view = view;
      storage.save(entries, activeId);
    }
  };
}
