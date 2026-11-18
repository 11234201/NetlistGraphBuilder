import assert from "node:assert/strict";
import test from "node:test";
import { createDomainWorkspaceStorage } from "../../src/persistence/domain_workspace_storage.js";

const archive = (name) => ({ domainId: "aig", source: { name, format: "blif", text: ".model x\n.end" } });

test("failed archive replacement removes the previous document and allows later saves", () => {
  const quotaError = new Error("Storage quota exceeded");
  const values = new Map([["unrelated", "keep"]]);
  let fail = false;
  const storage = createDomainWorkspaceStorage({
    getItem: (key) => values.get(key),
    setItem(key, value) { if (fail) throw quotaError; values.set(key, value); },
    removeItem: (key) => values.delete(key)
  });
  storage.save(archive("old.blif"));
  fail = true;
  assert.throws(() => storage.save(archive("new.blif")), (error) => error === quotaError);
  assert.equal(storage.load(), null, "reload must not revive an obsolete document");
  assert.equal(values.get("unrelated"), "keep");
  fail = false;
  storage.save(archive("recovered.blif"));
  assert.equal(storage.load().source.name, "recovered.blif");
});

test("archive cleanup failure preserves the save error and identifies both failures", () => {
  const quotaError = new Error("Storage quota exceeded");
  const cleanupError = new Error("Storage became unavailable");
  const storage = createDomainWorkspaceStorage({
    setItem() { throw quotaError; }, removeItem() { throw cleanupError; }
  });
  assert.throws(() => storage.save(archive("new.blif")), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [quotaError, cleanupError]);
    assert.equal(error.cause, quotaError);
    assert.match(error.message, /Storage quota exceeded/);
    assert.match(error.message, /Storage became unavailable/);
    return true;
  });
});

test("cleanup retains a non-Error save failure", () => {
  const storage = createDomainWorkspaceStorage({
    setItem() { throw null; }, removeItem() { throw "cleanup denied"; }
  });
  assert.throws(() => storage.save(archive("new.blif")), (error) => {
    assert.deepEqual(error.errors, [null, "cleanup denied"]);
    assert.equal(error.cause, null);
    assert.match(error.message, /null.*cleanup denied/);
    return true;
  });
});
