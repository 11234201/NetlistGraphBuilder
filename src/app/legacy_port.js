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
      if (!nestedPorts.has(key)) nestedPorts.set(key, createNestedPort(() => getTarget()[key], fields, writable, key));
      return nestedPorts.get(key);
    } };
    if (writable) descriptor.set = (value) => { getTarget()[key] = value; };
    Object.defineProperty(port, key, descriptor);
  }
  return Object.preventExtensions(port);
}

function createNestedPort(getTarget, fields, writable, label) {
  const allowed = new Set(fields);
  const rejectMutation = (key) => { throw new Error(`Undeclared nested state mutation ${label}.${String(key)}`); };
  return new Proxy(Object.create(null), {
    get(_facade, key) {
      if (typeof key === "symbol") return undefined;
      if (allowed.has(key)) return Reflect.get(getTarget(), key);
      throw new Error(`Undeclared nested state dependency ${label}.${String(key)}`);
    },
    set(_facade, key, value) {
      if (!writable || !allowed.has(key)) return rejectMutation(key);
      return Reflect.set(getTarget(), key, value);
    },
    has(_object, key) { return allowed.has(key); }
    ,ownKeys() { return [...allowed]; }
    ,getOwnPropertyDescriptor(_facade, key) {
      if (!allowed.has(key)) return undefined;
      return { enumerable: true, configurable: true, value: Reflect.get(getTarget(), key), writable };
    }
    ,defineProperty(_facade, key, descriptor) {
      if (!writable || !allowed.has(key) || !("value" in descriptor)) return rejectMutation(key);
      return Reflect.set(getTarget(), key, descriptor.value);
    }
    ,deleteProperty(_facade, key) { return rejectMutation(key); }
  });
}
