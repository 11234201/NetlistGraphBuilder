import assert from "node:assert/strict";
import test from "node:test";
import { createViewHistoryTransaction } from "../../src/app/viewHistoryTransaction.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

test("nested actions commit one identity, preserve the outer label and merge affected sessions", () => {
  const commits = [];
  const before = [];
  const transactions = createViewHistoryTransaction({
    before(metadata) { assert.equal(transactions.isActive(), false); before.push(metadata); },
    commit(metadata) { assert.equal(transactions.capture({ label: "recursive" }), false); commits.push(metadata); }
  });
  const result = transactions.run({ label: "outer", affectedSessionIds: ["single:primary"] }, () => {
    assert.equal(transactions.capture({ label: "inner", transactionId: "cannot-replace", affectedSessionIds: ["compare:left"] }), true);
    return transactions.run({ label: "nested", affectedSessionIds: ["compare:left", "compare:right"] }, () => "done");
  });
  assert.equal(result, "done");
  assert.deepEqual(commits, [{ transactionId: "operation:1", label: "outer",
    affectedSessionIds: ["single:primary", "compare:left", "compare:right"] }]);
  assert.deepEqual(before, [{ transactionId: "operation:1", label: "outer", affectedSessionIds: ["single:primary"] }]);
  assert.equal(transactions.isActive(), false);
});

test("synchronous failures release capture and do not commit a partially completed operation", () => {
  const commits = [];
  const transactions = createViewHistoryTransaction({ commit: (metadata) => commits.push(metadata) });
  assert.throws(() => transactions.run({ label: "failed" }, () => { throw new Error("boom"); }), /boom/);
  assert.deepEqual(commits, []);
  assert.equal(transactions.capture({ label: "outside" }), false);
  transactions.run({ label: "recovered" }, () => {});
  assert.equal(commits[0].transactionId, "operation:2");
});

test("async completion does not publish after a later user operation", async () => {
  const commits = [];
  const pending = deferred();
  const transactions = createViewHistoryTransaction({ commit: (metadata) => commits.push(metadata) });
  const completion = transactions.run({ label: "load" }, () => pending.promise);
  assert.equal(transactions.isActive(), false);
  assert.deepEqual(commits, [{ transactionId: "operation:1", label: "load" }]);
  transactions.run({ label: "select" }, () => transactions.capture({ affectedSessionIds: ["single:primary"] }));
  pending.resolve("loaded");
  assert.equal(await completion, "loaded");
  assert.deepEqual(commits, [
    { transactionId: "operation:1", label: "load" },
    { transactionId: "operation:2", label: "select", affectedSessionIds: ["single:primary"] }
  ]);
});

test("async rejection propagates without a completion commit or a leaked scope", async () => {
  const commits = [];
  const pending = deferred();
  const transactions = createViewHistoryTransaction({ commit: (metadata) => commits.push(metadata) });
  const completion = transactions.run({ label: "load" }, () => pending.promise);
  pending.reject(new Error("cancelled"));
  await assert.rejects(completion, /cancelled/);
  assert.deepEqual(commits, [{ transactionId: "operation:1", label: "load" }]);
  assert.equal(transactions.isActive(), false);
});

test("a current async operation publishes its successful completion with the original identity", async () => {
  const commits = [];
  const pending = deferred();
  const transactions = createViewHistoryTransaction({ commit: (metadata) => commits.push(metadata) });
  const completion = transactions.run({ label: "load" }, () => pending.promise);
  pending.resolve("loaded");
  assert.equal(await completion, "loaded");
  assert.deepEqual(commits, [
    { transactionId: "operation:1", label: "load" },
    { transactionId: "operation:1", label: "load", continuation: true }
  ]);
});

test("Back and Forward invalidation cannot revive a callback with the same history identity", async () => {
  const commits = [];
  const pending = deferred();
  let callback;
  let changed = false;
  let cancellations = 0;
  const transactions = createViewHistoryTransaction({ commit: (metadata) => commits.push(metadata) });
  const completion = transactions.run({ label: "load" }, () => {
    callback = transactions.bind(() => { changed = true; pending.resolve("loaded"); }, function (reason) {
      assert.equal(transactions.isActive(), false);
      cancellations++;
      pending.resolve(this.prefix + reason);
    });
    return pending.promise;
  });
  const historyIdentity = commits[0].transactionId;
  transactions.invalidate(); // Back leaves the operation's history entry.
  transactions.invalidate(); // Forward can return to the same entry, not the same live operation.
  assert.equal(commits[0].transactionId, historyIdentity);
  callback.call({ prefix: "cancelled:" }, "stale");
  assert.equal(await completion, "cancelled:stale");
  assert.equal(changed, false);
  assert.equal(cancellations, 1);
  assert.equal(commits.length, 1);
});

test("an invalidated async operation still rejects normally without publishing completion", async () => {
  const commits = [];
  const pending = deferred();
  const transactions = createViewHistoryTransaction({ commit: (metadata) => commits.push(metadata) });
  const completion = transactions.run({ label: "load" }, () => pending.promise);
  transactions.invalidate();
  pending.reject(new Error("cancelled"));
  await assert.rejects(completion, /cancelled/);
  assert.equal(commits.length, 1);
});

test("bound callbacks preserve receiver, arguments and operation identity", () => {
  const commits = [];
  const before = [];
  let callback;
  const transactions = createViewHistoryTransaction({ before: (metadata) => before.push(metadata), commit: (metadata) => commits.push(metadata) });
  transactions.run({ label: "search", affectedSessionIds: ["single:primary"] }, () => {
    callback = transactions.bind(function (value) {
      assert.equal(transactions.isActive(), true);
      transactions.capture({ label: "render", transactionId: "ignored", affectedSessionIds: ["compare:left"] });
      return this.prefix + value;
    });
  });
  assert.equal(callback.call({ prefix: "result:" }, "cell"), "result:cell");
  assert.equal(before.length, 1);
  assert.deepEqual(commits, [
    { transactionId: "operation:1", label: "search", affectedSessionIds: ["single:primary"] },
    { transactionId: "operation:1", label: "search", affectedSessionIds: ["single:primary", "compare:left"], continuation: true }
  ]);
});

test("a bound callback called within its own operation does not add an intermediate commit", () => {
  const commits = [];
  const transactions = createViewHistoryTransaction({ commit: (metadata) => commits.push(metadata) });
  transactions.run({ label: "focus" }, () => transactions.bind(() => {
    transactions.capture({ affectedSessionIds: ["single:primary"] });
  })());
  assert.deepEqual(commits, [{ transactionId: "operation:1", label: "focus", affectedSessionIds: ["single:primary"] }]);
});

test("async bound continuations release capture between their synchronous and completion segments", async () => {
  const commits = [];
  const pending = deferred();
  let callback;
  const transactions = createViewHistoryTransaction({ commit: (metadata) => commits.push(metadata) });
  transactions.run({ label: "search" }, () => { callback = transactions.bind(() => pending.promise); });
  const completion = callback();
  assert.equal(transactions.isActive(), false);
  transactions.run({ label: "other" }, () => {});
  pending.resolve(7);
  assert.equal(await completion, 7);
  assert.deepEqual(commits.map(({ transactionId, continuation }) => [transactionId, Boolean(continuation)]), [
    ["operation:1", false], ["operation:1", true], ["operation:2", false]
  ]);
});

test("a bound callback cannot replace another operation's active scope", () => {
  const commits = [];
  let callback;
  let stale = 0;
  const transactions = createViewHistoryTransaction({ commit: (metadata) => commits.push(metadata) });
  transactions.run({ label: "old" }, () => {
    callback = transactions.bind(() => assert.fail("Stale callback changed the UI"), () => { stale++; });
  });
  transactions.run({ label: "new" }, () => {
    callback();
    assert.equal(transactions.isActive(), true);
    transactions.capture({ affectedSessionIds: ["new-session"] });
  });
  assert.deepEqual(commits, [
    { transactionId: "operation:1", label: "old" },
    { transactionId: "operation:2", label: "new", affectedSessionIds: ["new-session"] }
  ]);
  assert.equal(stale, 1);
});

test("unbound callbacks pass through and thrown current callbacks release their scope", () => {
  const commits = [];
  const transactions = createViewHistoryTransaction({ commit: (metadata) => commits.push(metadata) });
  const outside = () => "outside";
  assert.equal(transactions.bind(outside), outside);
  let callback;
  transactions.run({ label: "old" }, () => { callback = transactions.bind(() => { throw new Error("callback failed"); }); });
  assert.throws(callback, /callback failed/);
  assert.equal(transactions.isActive(), false);
  transactions.run({ label: "new" }, () => {
    assert.equal(transactions.isActive(), true);
    transactions.capture({ affectedSessionIds: ["new-session"] });
  });
  assert.equal(commits.length, 2);
  assert.equal(commits[1].transactionId, "operation:2");
  assert.equal(transactions.isActive(), false);
});

test("before and commit errors do not strand the capture scope", () => {
  let failBefore = true;
  let failCommit = true;
  const transactions = createViewHistoryTransaction({
    before() { if (failBefore) throw new Error("before failed"); },
    commit() { if (failCommit) throw new Error("commit failed"); }
  });
  assert.throws(() => transactions.run({}, () => {}), /before failed/);
  assert.equal(transactions.isActive(), false);
  failBefore = false;
  assert.throws(() => transactions.run({}, () => {}), /commit failed/);
  assert.equal(transactions.isActive(), false);
  failCommit = false;
  assert.doesNotThrow(() => transactions.run({}, () => {}));
});
