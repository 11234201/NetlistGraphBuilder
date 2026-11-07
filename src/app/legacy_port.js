// Only existing adapters use writable legacy ports. New application use cases
// consume ViewSession commands and explicit read-only inputs instead.
export function createLegacyPort(getTarget, keys, { writable = false, nestedFields = {} } = {}) {
  const port = Object.create(null);
  const nestedPorts = new Map();
  for (const key of keys) {
    const descriptor = { enumerable: true, get: () => {
      const target = getTarget()[key];
      const fields = nestedFields[key];
      if (!fields || !target || typeof target !== "object") return target;
      if (!nestedPorts.has(key)) nestedPorts.set(key, createNestedPort(target, fields, writable, key));
      return nestedPorts.get(key);
    } };
    if (writable) descriptor.set = (value) => { getTarget()[key] = value; };
    Object.defineProperty(port, key, descriptor);
  }
  return Object.preventExtensions(port);
}

function createNestedPort(target, fields, writable, label) {
  const allowed = new Set(fields);
  return new Proxy(target, {
    get(object, key, receiver) {
      if (typeof key === "symbol" || allowed.has(key)) return Reflect.get(object, key, receiver);
      throw new Error(`Undeclared nested state dependency ${label}.${String(key)}`);
    },
    set(object, key, value, receiver) {
      if (!writable || !allowed.has(key)) throw new Error(`Undeclared nested state mutation ${label}.${String(key)}`);
      return Reflect.set(object, key, value, receiver);
    },
    has(_object, key) { return allowed.has(key); }
  });
}
