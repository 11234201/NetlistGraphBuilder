import assert from "node:assert/strict";
import test from "node:test";
import { createViewSessionStore } from "../../src/application/view_session_store.js";
import { immutableSnapshot } from "../../src/foundation/immutable_snapshot.js";

test("session inputs and returned nested records cannot mutate a committed revision", () => {
  const position = { x: 10, y: 20 };
  const overrides = { nodePositions: new Map([["u", position]]), flags: new Set(["x"]) };
  const layoutPolicy = { spacing: { cellSpacing: 8 } };
  const sessions = createViewSessionStore([{ sessionId: "s", documentId: "d", unitId: "top", domainId: "netlist", overrides, layoutPolicy }]);
  const session = sessions.require("s");
  position.x = 999;
  overrides.nodePositions.clear();
  layoutPolicy.spacing.cellSpacing = 999;
  assert.equal(session.overrides.nodePositions.get("u").x, 10);
  assert.equal(session.layoutPolicy.spacing.cellSpacing, 8);
  assert.throws(() => { session.layoutPolicy.spacing.cellSpacing = 99; }, TypeError);
  assert.throws(() => { session.overrides.nodePositions.get("u").x = 99; }, TypeError);
  assert.throws(() => session.overrides.nodePositions.set("v", {}), TypeError);
  assert.throws(() => session.overrides.nodePositions.valueOf().clear(), TypeError);
  assert.throws(() => session.overrides.nodePositions.forEach((value, key, map) => map.clear()), TypeError);
  assert.throws(() => Map.prototype.set.call(session.overrides.nodePositions, "v", {}), TypeError);
  assert.throws(() => session.overrides.flags.add("y"), TypeError);
  assert.equal(session.computationRevision, 1);
  const updated = sessions.update("s", () => ({ overrides: { nodePositions: new Map([["u", { x: 30, y: 40 }]]) } }));
  assert.equal(updated.computationRevision, 2);
  assert.equal(updated.overrides.nodePositions.get("u").x, 30);
  assert.equal(session.overrides.nodePositions.get("u").x, 10);
});

test("snapshots preserve sparse array length and reject identity-sensitive Map keys", () => {
  const sparse = new Array(4);
  sparse[2] = "x";
  const sessions = createViewSessionStore([{ sessionId: "s", documentId: "d", unitId: "top", domainId: "netlist",
    overrides: { sparse } }]);
  assert.equal(sessions.require("s").overrides.sparse.length, 4);
  assert.equal(0 in sessions.require("s").overrides.sparse, false);
  assert.throws(() => createViewSessionStore([{ sessionId: "x", documentId: "d", unitId: "top", domainId: "netlist",
    overrides: { keyed: new Map([[{}, "value"]]) } }]), /Map keys must be primitive/);
});

test("snapshots reject function values in ordinary fields and collections by default", () => {
  assert.throws(() => immutableSnapshot({ callback() {} }), /function values/);
  assert.throws(() => immutableSnapshot(new Set([() => {}])), /function values/);
});

test("snapshots allow and freeze function values when allowFunctions is enabled", () => {
  const fn = (x) => x * 2;
  const snapshot = immutableSnapshot({ reader: fn, nested: { count: 3 } }, { allowFunctions: true });
  assert.equal(typeof snapshot.reader, "function");
  assert.equal(snapshot.reader(5), 10);
  assert.equal(Object.isFrozen(snapshot.reader), true);
  assert.throws(() => { snapshot.nested.count = 4; }, TypeError);
});
