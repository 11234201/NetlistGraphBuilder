import assert from "node:assert/strict";
import test from "node:test";
import { createViewHistoryTransaction } from "../../src/app/viewHistoryTransaction.js";

test("nested view actions commit exactly one transaction with merged metadata", () => {
  const commits = [];
  const transactions = createViewHistoryTransaction({ commit: (metadata) => commits.push(metadata) });
  const result = transactions.run({ label: "outer", affectedSessionIds: ["single:primary"] }, () => {
    assert.equal(transactions.capture({ label: "inner" }), true);
    return transactions.run({ label: "nested" }, () => "done");
  });

  assert.equal(result, "done");
  assert.deepEqual(commits, [{ label: "inner", affectedSessionIds: ["single:primary"] }]);
  assert.equal(transactions.isActive(), false);
});

test("failed transactions do not create history entries", () => {
  const commits = [];
  const transactions = createViewHistoryTransaction({ commit: (metadata) => commits.push(metadata) });
  assert.throws(() => transactions.run({ label: "failed" }, () => { throw new Error("boom"); }), /boom/);
  assert.deepEqual(commits, []);
  assert.equal(transactions.isActive(), false);
});
