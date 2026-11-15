import assert from "node:assert/strict";
import test from "node:test";
import { createImportRequests } from "../../src/application/import_requests.js";

test("a newer import aborts the previous source before its next asynchronous continuation", () => {
  const requests = createImportRequests();
  const previous = requests.begin();
  let cancelled = false;
  previous.signal.addEventListener("abort", () => { cancelled = true; });
  const latest = requests.begin();
  assert.equal(cancelled, true);
  assert.equal(previous.isCurrent(), false);
  assert.equal(previous.isLatest(), false);
  assert.equal(latest.isCurrent(), true);
  previous.cancel();
  assert.equal(latest.isCurrent(), true, "an obsolete owner's cancel cannot cancel newer input");
});

test("explicit cancel remains distinguishable from replacement for startup fallback", () => {
  const requests = createImportRequests();
  const request = requests.begin();
  request.cancel();
  assert.equal(request.signal.aborted, true);
  assert.equal(request.isCurrent(), false);
  assert.equal(request.isLatest(), true);
  requests.begin();
  assert.equal(request.isLatest(), false);
});
