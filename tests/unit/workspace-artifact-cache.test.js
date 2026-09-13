import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorkspaceArtifactCache,
  createWorkspaceArtifactKey
} from "../../src/app/workspaceArtifactCache.js";

test("workspace artifact cache uses stable identities and bounded LRU eviction", () => {
  const cache = createWorkspaceArtifactCache({ capacity: 2 });
  const first = { value: 1 };
  const keyA = createWorkspaceArtifactKey({ stage: "graph", module: "top", roots: new Set(["a", "b"]) });
  const keyAReordered = createWorkspaceArtifactKey({ roots: new Set(["b", "a"]), module: "top", stage: "graph" });
  cache.put(keyA, first, { documentId: "doc" });
  assert.equal(cache.get(keyAReordered), first);
  cache.put("b", { value: 2 }, { documentId: "doc" });
  cache.put("c", { value: 3 }, { documentId: "doc" });
  assert.equal(cache.get(keyA), null);
  assert.equal(cache.stats().evictions, 1);
  assert.equal(cache.stats().hits, 1);
});

test("workspace artifact cache invalidates by document and session metadata", () => {
  const cache = createWorkspaceArtifactCache({ capacity: 4 });
  cache.put("a", 1, { documentId: "doc-a", sessionId: "session-a" });
  cache.put("b", 2, { documentId: "doc-b", sessionId: "session-a" });
  cache.put("c", 3, { documentId: "doc-b", sessionId: "session-b" });
  assert.equal(cache.clearDocument("doc-b"), 2);
  assert.equal(cache.get("a"), 1);
  assert.equal(cache.clearSession("session-a"), 1);
  assert.equal(cache.get("a"), null);
});
