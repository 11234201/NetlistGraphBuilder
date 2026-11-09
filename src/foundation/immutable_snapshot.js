const snapshots = new WeakSet();

// Snapshot supported session data, including collections whose native mutators
// are not disabled by Object.freeze. Never expose a collection's backing target.
export function immutableSnapshot(value, options = {}, seen = new WeakMap()) {
  let opts = options;
  let seenMap = seen;
  if (options instanceof WeakMap) {
    seenMap = options;
    opts = {};
  }
  const allowFunctions = Boolean(opts?.allowFunctions);
  if (typeof value === "function") {
    if (!allowFunctions) {
      throw new TypeError("Session snapshots do not support function values");
    }
    Object.freeze(value);
    return value;
  }
  if (value === null || typeof value !== "object") return value;
  if (snapshots.has(value)) return value;
  if (seenMap.has(value)) return seenMap.get(value);
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
    seenMap.set(value, proxy);
    if (isMap) for (const [key, item] of value) {
      if (key !== null && (typeof key === "object" || typeof key === "function")) {
        throw new TypeError("Session snapshot Map keys must be primitive values");
      }
      target.set(key, immutableSnapshot(item, opts, seenMap));
    }
    else for (const item of value) target.add(immutableSnapshot(item, opts, seenMap));
    Object.freeze(proxy);
    snapshots.add(proxy);
    return proxy;
  }
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new TypeError("Session snapshots require plain records, arrays, Maps or Sets");
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError("Session snapshots do not support Symbol properties");
  }
  const result = Array.isArray(value) ? new Array(value.length) : {};
  seenMap.set(value, result);
  for (const key of Object.keys(value)) Object.defineProperty(result, key, {
    value: immutableSnapshot(value[key], opts, seenMap), enumerable: true, configurable: true, writable: true
  });
  Object.freeze(result);
  snapshots.add(result);
  return result;
}
