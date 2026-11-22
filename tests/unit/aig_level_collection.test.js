import test from "node:test";
import assert from "node:assert/strict";
import { createAigCollection } from "../../src/app/aig_collection.js";
import { createAigCollectionStorage } from "../../src/persistence/aig_collection_storage.js";
import { aigLevelFailureDetails } from "../../src/app/aig_level_input.js";
import { importAigSource } from "../../src/domains/aig/aig_import.js";

test("replacing an AIG or attaching Level needs storage for just the resulting archive", () => {
  const quotaError = new DOMException("Storage quota exceeded", "QuotaExceededError");
  const storage = {
    getItem(key) { return this[key] ?? null; },
    setItem(key, value) {
      const others = Object.entries(this).filter(([id, item]) => id !== key && typeof item === "string");
      if (value.length + others.reduce((sum, [, item]) => sum + item.length, 0) > 1800) throw quotaError;
      this[key] = value;
    },
    removeItem(key) { delete this[key]; }
  };
  const archive = createAigCollectionStorage(() => storage);
  const collection = createAigCollection({ render() {} });
  const plain = { name: "first.blif", text: "x".repeat(1200) };
  const annotated = { ...plain, levelFile: { name: "first.level", text: "a 4" } };
  function save(source, id) {
    collection.commit(source, id);
    collection.save({}, archive);
    assert.deepEqual(createAigCollectionStorage(() => storage).load().entries[0].source, source);
  }
  save(plain);
  save(annotated, collection.active());
  save({ ...annotated, name: "other.blif" });
  save(plain);
  collection.commit({ ...annotated, levelFile: { name: "large.level", text: "y".repeat(1000) } }, collection.active());
  assert.throws(() => collection.save({}, archive), error => error === quotaError);
  assert.equal(archive.load(), null);
  assert.equal(collection.list()[0].levelFileName, "large.level");
});

test("paired import diagnostics distinguish design syntax, Level binding, and workspace preparation failures", () => {
  const levelFile = { name: "inputs.level", text: "missing 3" };
  const input = { name: "logic.blif", text: ".model m\n.inputs a\n.outputs a\n.end", levelFile };
  assert.throws(() => importAigSource(input.text, { name: input.name, levelFile }), error => {
    const details = aigLevelFailureDetails(input, error);
    assert.equal(details.operation, "aig.level.import");
    assert.equal(details.fileName, levelFile.name);
    assert.equal(details.line, 1);
    return true;
  });
  assert.throws(() => importAigSource(".model m\n.unsupported\n.end", { name: input.name, levelFile }), error => {
    const details = aigLevelFailureDetails(input, error);
    assert.equal(details.operation, "aig.import");
    assert.equal(details.fileName, input.name);
    assert.equal(details.line, 2);
    return true;
  });
  const timeout = Object.assign(new Error("Graphviz timed out"), { name: "TimeoutError" });
  const details = aigLevelFailureDetails(input, timeout, { jobId: "layout:1" });
  assert.equal(details.fileName, input.name);
  assert.equal(details.operation, "aig.workspace.prepare");
  assert.equal(details.levelFileName, levelFile.name);
});

test("AIG Level attachments survive single and multi-graph archives, switch and replace by graph ID", async () => {
  const writes = [];
  const storage = {
    getItem(key) { return this[key] ?? null; },
    setItem(key, value) { this[key] = value; writes.push(key); },
    removeItem(key) { delete this[key]; }
  };
  const archive = createAigCollectionStorage(() => storage);
  const request = { signal: new AbortController().signal };
  let activeSource;
  const collection = createAigCollection({
    validate() {}, render() {},
    async activate(source, view) {
      activeSource = source;
      collection.commit(source, view?.graphId);
    }
  });
  const level = (name, text) => ({ name, text });
  const design = { name: "same.blif", text: "source", format: "blif" };
  const first = { ...design, levelFile: level("first.level", "a 2") };
  collection.commit(first);
  collection.save({ selectedId: "n1" }, archive);
  writes.length = 0;
  collection.save({ selectedId: "n1", viewport: { x: 0, y: 1, scale: 1 } }, archive);
  assert.equal(writes.some((key) => key.startsWith("ngb.aig-source.")), false);
  assert.deepEqual(archive.load().entries[0].source, first);
  const second = { ...design, levelFile: level("second.level", "b 4") };
  await collection.add([second], request);
  collection.save({ selectedId: "n1" }, archive);
  const replacement = { ...design, levelFile: level("eco.level", "a 7") };
  collection.checkReplacement(replacement);
  collection.commit(replacement, "g1");
  collection.save({ selectedId: "n1" }, archive);
  assert.deepEqual(archive.load().entries.map((entry) => entry.source), [replacement, second]);
  await collection.switchTo("g2", request);
  assert.deepEqual(activeSource, second);
  collection.save({ selectedId: "n2" }, archive);
  writes.length = 0;
  collection.save({ selectedId: "n2" }, archive);
  assert.equal(writes.some((key) => key.startsWith("ngb.aig-source.")), false);
  const restored = createAigCollectionStorage(() => storage).load();
  const entry = collection.restore(restored);
  assert.deepEqual(entry.source, second);
  await collection.switchTo("g1", request);
  assert.deepEqual(activeSource, replacement);
  assert.equal(collection.list()[0].levelFileName, "eco.level");
});
