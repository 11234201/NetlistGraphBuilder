import { readonlyCollection } from "./readonly_collection.js";

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
    const proxy = readonlyCollection(target);
    seenMap.set(value, proxy);
    if (isMap) for (const [key, item] of value) {
      if (key !== null && (typeof key === "object" || typeof key === "function")) {
        throw new TypeError("Session snapshot Map keys must be primitive values");
      }
      target.set(key, immutableSnapshot(item, opts, seenMap));
    }
    else for (const item of value) target.add(immutableSnapshot(item, opts, seenMap));
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
  for (const key of Object.keys(value)) {
    const item = immutableSnapshot(value[key], opts, seenMap);
    // Ordinary fresh data properties can use the fast assignment path. Keep
    // inherited names (especially __proto__ and accessors) as own data fields.
    if (key in result) Object.defineProperty(result, key, {
      value: item, enumerable: true, configurable: true, writable: true
    });
    else result[key] = item;
  }
  Object.freeze(result);
  snapshots.add(result);
  return result;
}
