const snapshots = new WeakSet();

// Snapshot supported session data, including collections whose native mutators
// are not disabled by Object.freeze. Never expose a collection's backing target.
export function immutableSnapshot(value, seen = new WeakMap()) {
  if (value === null || typeof value !== "object") return value;
  if (snapshots.has(value)) return value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Map || value instanceof Set) {
    const isMap = value instanceof Map;
    const target = isMap ? new Map() : new Set();
    const reject = () => { throw new TypeError("Session snapshots are read-only"); };
    const proxy = new Proxy(target, {
      get(collection, key) {
        if (key === "valueOf") return () => proxy;
        if (["set", "add", "delete", "clear"].includes(key)) return reject;
        if (key === "forEach") return (callback, thisArg) => collection.forEach((item, itemKey) =>
          callback.call(thisArg, item, itemKey, proxy));
        const member = Reflect.get(collection, key, collection);
        return typeof member === "function" && key !== "constructor" ? member.bind(collection) : member;
      }
    });
    seen.set(value, proxy);
    if (isMap) for (const [key, item] of value) {
      if (key !== null && typeof key === "object") {
        throw new TypeError("Session snapshot Map keys must be primitive values");
      }
      target.set(key, immutableSnapshot(item, seen));
    }
    else for (const item of value) target.add(immutableSnapshot(item, seen));
    Object.freeze(proxy);
    snapshots.add(proxy);
    return proxy;
  }
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new TypeError("Session snapshots require plain records, arrays, Maps or Sets");
  }
  const result = Array.isArray(value) ? new Array(value.length) : {};
  seen.set(value, result);
  for (const key of Object.keys(value)) Object.defineProperty(result, key, {
    value: immutableSnapshot(value[key], seen), enumerable: true, configurable: true, writable: true
  });
  Object.freeze(result);
  snapshots.add(result);
  return result;
}
