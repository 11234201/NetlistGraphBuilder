import assert from "node:assert/strict";
import test from "node:test";
import { decodeSessionSnapshot, encodeSessionSnapshot, SESSION_CODEC_VERSION } from "../../src/persistence/session_codec.js";
import { LEGACY_SESSION_STATE_KEY, SESSION_STATE_KEY, loadSessionState, saveSessionState } from "../../src/app/sessionState.js";

test("session v2 codec preserves domain, unit and source identity", () => {
  const snapshot = {
    domainId: "netlist",
    documentId: "netlist:example",
    unitId: "top",
    sourceIdentity: { name: "top.v", size: 42 },
    source: "module top; endmodule"
  };
  const decoded = decodeSessionSnapshot(encodeSessionSnapshot(snapshot));

  assert.equal(decoded.version, SESSION_CODEC_VERSION);
  assert.equal(decoded.documentId, "netlist:example");
  assert.equal(decoded.unitId, "top");
  assert.deepEqual(decoded.sourceIdentity, { name: "top.v", size: 42, fingerprint: "fnv1a32:d94b1d8a" });
  assert.deepEqual(decoded.presentationPolicy, { gateSymbolMode: "rectangle" });
});

test("session v2 codec preserves the optional conventional gate symbol mode", () => {
  const decoded = decodeSessionSnapshot(encodeSessionSnapshot({
    presentationPolicy: { gateSymbolMode: "conventional" }
  }));
  assert.deepEqual(decoded.presentationPolicy, { gateSymbolMode: "conventional" });
});

test("session v2 codec preserves occurrence-aware focused root refs", () => {
  const decoded = decodeSessionSnapshot(encodeSessionSnapshot({
    focusedRootRefs: [{
      documentId: "netlist:example",
      unitId: "child",
      kind: "cell",
      localId: "leaf",
      occurrencePath: ["u_right"]
    }]
  }));
  assert.deepEqual(decoded.focusedRootRefs, [{
    documentId: "netlist:example",
    unitId: "child",
    kind: "cell",
    localId: "leaf",
    occurrencePath: ["u_right"]
  }]);
});

test("session v2 codec drops malformed focused root refs without breaking old snapshots", () => {
  const decoded = decodeSessionSnapshot({
    version: 2,
    focusedRootRefs: [{ documentId: "doc", unitId: "top", kind: "cell" }, "bad"]
  });
  assert.deepEqual(decoded.focusedRootRefs, []);
});

test("legacy session v1 fixture migrates a single module identity", () => {
  const migrated = decodeSessionSnapshot({
    version: 1,
    source: "module old; endmodule",
    sourceLabel: "old.v",
    moduleName: "old",
    coneRootNodeId: "cell:u0"
  });

  assert.equal(migrated.version, 2);
  assert.equal(migrated.domainId, "netlist");
  assert.equal(migrated.unitId, "old");
  assert.equal(migrated.sourceIdentity.name, "old.v");
  assert.equal(migrated.sourceIdentity.size, 21);
  assert.match(migrated.sourceIdentity.fingerprint, /^fnv1a32:/);
});

test("session storage prefers v2 and falls back to the legacy key", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  values.set(LEGACY_SESSION_STATE_KEY, JSON.stringify({ version: 1, moduleName: "legacy", source: "x" }));
  assert.equal(loadSessionState(storage).unitId, "legacy");

  assert.equal(saveSessionState({ domainId: "memory-aig", unitId: "top" }, storage), true);
  assert.ok(values.has(SESSION_STATE_KEY));
  assert.equal(loadSessionState(storage).domainId, "memory-aig");
});

test("session codec rejects malformed and unsupported inputs", () => {
  assert.throws(() => decodeSessionSnapshot("{"), /Invalid session JSON/);
  assert.throws(() => decodeSessionSnapshot({ version: 99 }), /Unsupported session version/);
});
