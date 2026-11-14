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

test("snapshot property copying preserves own prototype names, cycles and shared values", () => {
  const input = JSON.parse('{"__proto__":{"safe":true},"constructor":{"count":1},"toString":"label"}');
  input.shared = input.constructor;
  input.self = input;
  const snapshot = immutableSnapshot(input);
  assert.equal(Object.getPrototypeOf(snapshot), Object.prototype);
  assert.equal(Object.hasOwn(snapshot, "__proto__"), true);
  assert.deepEqual(snapshot.__proto__, { safe: true });
  assert.equal(snapshot.toString, "label");
  assert.equal(snapshot.shared, snapshot.constructor);
  assert.equal(snapshot.self, snapshot);
  input.constructor.count = 9;
  assert.equal(snapshot.constructor.count, 1);
  assert.throws(() => { snapshot.__proto__.safe = false; }, TypeError);
  assert.equal(immutableSnapshot(snapshot), snapshot);
});

test("snapshot copying does not invoke inherited setters or skip strict value checks", () => {
  const key = "snapshotInheritedSetterTest";
  Object.defineProperty(Object.prototype, key, { configurable: true,
    set() { throw new Error("inherited setter must not run"); } });
  try {
    const input = { [key]: { count: 3 } };
    const snapshot = immutableSnapshot(input);
    assert.deepEqual(snapshot[key], { count: 3 });
    assert.equal(Object.hasOwn(snapshot, key), true);
  } finally { delete Object.prototype[key]; }
  assert.throws(() => immutableSnapshot({ [Symbol("hidden")]: 1 }), /Symbol properties/);
  assert.throws(() => immutableSnapshot({ nested: new Date() }), /plain records/);
  const sparse = new Array(5);
  sparse[2] = { count: 1 };
  Object.defineProperty(sparse, "__proto__", { value: { safe: true }, enumerable: true });
  const snapshot = immutableSnapshot(sparse);
  assert.equal(snapshot.length, 5);
  assert.equal(0 in snapshot, false);
  assert.equal(Object.getPrototypeOf(snapshot), Array.prototype);
  assert.deepEqual(snapshot.__proto__, { safe: true });
});

test("collection snapshots reject unlisted methods and keep accessor receivers private", () => {
  const write = Symbol("future collection writer");
  const receiver = Symbol("future collection receiver");
  for (const Type of [Map, Set]) {
    Object.defineProperty(Type.prototype, write, { configurable: true,
      value(value) { Type === Map ? this.set("new", value) : this.add(value); } });
    Object.defineProperty(Type.prototype, receiver, { configurable: true, get() { return this; } });
    try {
      const snapshot = immutableSnapshot(Type === Map ? new Map([["old", { count: 1 }]]) : new Set(["old"]));
      assert.throws(() => snapshot[write]({ count: 2 }), /read-only/);
      assert.equal(snapshot[receiver], snapshot);
      assert.equal(snapshot.size, 1);
      assert.equal(snapshot.valueOf(), snapshot);
      assert.equal(snapshot.constructor, Type);
      assert.equal(String(snapshot), Type === Map ? "[object Map]" : "[object Set]");
      assert.equal(snapshot.has("old"), true);
      assert.deepEqual([...snapshot.keys()], ["old"]);
      snapshot.forEach((value, key, collection) => assert.equal(collection, snapshot));
      // An absent `then` must not become a rejecting Promise-like method.
      assert.equal(snapshot.then, undefined);
    } finally {
      delete Type.prototype[write];
      delete Type.prototype[receiver];
    }
  }
});

test("read-only Set algebra leaves source values and membership protected", () => {
  const snapshot = immutableSnapshot(new Set(["a", "b"]));
  if (typeof Set.prototype.union === "function") {
    const union = snapshot.union(new Set(["c"]));
    assert.deepEqual([...union], ["a", "b", "c"]);
    union.add("d");
    assert.deepEqual([...snapshot], ["a", "b"]);
    assert.equal(snapshot.isSubsetOf(union), true);
    assert.deepEqual([...snapshot.intersection(new Set(["b"]))], ["b"]);
  }
});
