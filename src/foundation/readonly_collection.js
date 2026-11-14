const READ_METHODS = new Set([
  "get", "has", "entries", "keys", "values", Symbol.iterator,
  "union", "intersection", "difference", "symmetricDifference",
  "isSubsetOf", "isSupersetOf", "isDisjointFrom",
  "toString", "toLocaleString", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable"
]);

// A read-only view of a privately owned Map/Set. The caller must keep the
// backing collection private and protect its entries before publishing it.
export function readonlyCollection(target) {
  const reject = () => { throw new TypeError("Session snapshots are read-only"); };
  const proxy = new Proxy(target, {
    get(collection, key) {
      if (key === "valueOf") return () => proxy;
      if (key === "forEach") return (callback, thisArg) => collection.forEach((item, itemKey) =>
        callback.call(thisArg, item, itemKey, proxy));
      if (key === "size") return Reflect.get(collection, key, collection);
      // Unknown accessors see the proxy, never the backing collection. Only
      // reviewed read methods receive the native receiver they require.
      const member = Reflect.get(collection, key, proxy);
      if (typeof member !== "function" || key === "constructor") return member;
      return READ_METHODS.has(key) ? member.bind(collection) : reject;
    }
  });
  return Object.freeze(proxy);
}
