const REQUIRED_METHODS = Object.freeze([
  "importSource",
  "listUnits",
  "buildSearchIndex",
  "search",
  "queryView",
  "projectDiagram"
]);

export function defineDomainFeature(value) {
  if (!value || typeof value !== "object") throw new Error("Domain feature must be an object");
  if (typeof value.id !== "string" || value.id.length === 0) throw new Error("Domain feature id is required");
  for (const method of REQUIRED_METHODS) {
    if (typeof value[method] !== "function") throw new Error(`Domain feature ${value.id} requires ${method}()`);
  }
  for (const field of ["inputFormats", "commands", "panels", "layoutProfiles"]) {
    if (value[field] !== undefined && !Array.isArray(value[field])) {
      throw new Error(`Domain feature ${value.id} ${field} must be an array`);
    }
  }
  if (value.capabilities !== undefined && (!value.capabilities || typeof value.capabilities !== "object" || Array.isArray(value.capabilities))) {
    throw new Error(`Domain feature ${value.id} capabilities must be an object`);
  }
  return Object.freeze({
    ...value,
    inputFormats: Object.freeze([...(value.inputFormats || [])]),
    capabilities: Object.freeze({ ...(value.capabilities || {}) }),
    commands: Object.freeze([...(value.commands || [])]),
    panels: Object.freeze([...(value.panels || [])]),
    layoutProfiles: Object.freeze([...(value.layoutProfiles || [])])
  });
}
