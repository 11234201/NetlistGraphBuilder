const VIEW_MODES = new Set(["whole", "focused", "search-first"]);

/** Normalizes a domain query while retaining domain-specific extension fields. */
export function createViewQuery(value) {
  if (!value || typeof value.unitId !== "string" || value.unitId.length === 0) {
    throw new Error("View query unitId is required");
  }
  const mode = value.mode || "whole";
  if (!VIEW_MODES.has(mode)) throw new Error(`Unsupported view query mode: ${mode}`);
  if (value.rootNodeIds !== undefined && !Array.isArray(value.rootNodeIds)) {
    throw new Error("View query rootNodeIds must be an array");
  }
  const rootNodeIds = [...new Set((value.rootNodeIds || []).map((id) => {
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("View query rootNodeIds must contain non-empty strings");
    }
    return id;
  }))];
  return Object.freeze({
    ...value,
    mode,
    rootNodeIds: Object.freeze(rootNodeIds)
  });
}
