import assert from "node:assert/strict";
import test from "node:test";
import { createDebouncedPersistence } from "../../src/application/debounced_persistence.js";

test("persistence coalesces requests and reads the latest snapshot only when saving", () => {
  const pending = new Map(), saved = [];
  let revision = 1, next = 0, reads = 0;
  const persistence = createDebouncedPersistence({
    readSnapshot: () => { reads++; return { revision }; },
    save: (snapshot) => { saved.push(snapshot); return { ok: true }; },
    schedule: (task) => { pending.set(++next, task); return next; },
    cancel: (id) => pending.delete(id)
  });
  persistence.request();
  revision = 2;
  persistence.request();
  assert.equal(reads, 0);
  assert.equal(pending.size, 1);
  persistence.flush();
  assert.deepEqual(saved, [{ revision: 2 }]);
  assert.equal(pending.size, 0);
  persistence.request();
  persistence.cancel();
  assert.equal(pending.size, 0);
  assert.equal(reads, 1);
});

test("persistence reports a failure once, recovers, then reports a later failure", () => {
  const events = [], failure = new Error("unavailable");
  let throwing = true;
  const persistence = createDebouncedPersistence({
    readSnapshot: () => { if (throwing) throw failure; return {}; },
    save: () => ({ ok: true }),
    onFailure: (error) => events.push(error), onRecovered: () => events.push("recovered")
  });
  persistence.flush();
  persistence.flush();
  assert.deepEqual(events, [failure]);
  throwing = false;
  persistence.flush();
  throwing = true;
  persistence.flush();
  assert.deepEqual(events, [failure, "recovered", failure]);
});

test("a pending save waits across a following gesture without reading its preview", () => {
  const pending = new Map(), saved = [];
  let next = 0, busy = false, revision = 1, reads = 0;
  const persistence = createDebouncedPersistence({
    readSnapshot: () => { reads++; return { revision }; },
    save: (snapshot) => { saved.push(snapshot); return { ok: true }; },
    canFlush: () => !busy,
    schedule: (task) => { pending.set(++next, task); return next; },
    cancel: (id) => pending.delete(id)
  });
  const tick = () => { const [id, task] = pending.entries().next().value; pending.delete(id); task(); };
  persistence.request();
  busy = true;
  for (let i = 0; i < 4; i++) { tick(); assert.equal(pending.size, 1); }
  assert.equal(reads, 0);
  revision = 2;
  busy = false;
  tick();
  assert.deepEqual(saved, [{ revision: 2 }]);
  assert.equal(pending.size, 0);
  busy = true;
  persistence.request(); tick(); persistence.cancel();
  assert.equal(pending.size, 0);
});
