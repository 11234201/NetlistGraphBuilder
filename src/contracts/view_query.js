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

export const DEFAULT_VIEW_QUERY = Object.freeze({ viewMode: "whole", coneDepth: 3, faninDepth: 3, fanoutDepth: 3 });

export function normalizeViewDepth(value, fallback = 3, minimum = 0) {
  if (value === undefined || value === null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("View depth must be finite");
  return Math.min(99, Math.max(minimum, Math.floor(number)));
}

export function normalizeViewQuery(value = {}, fallback = DEFAULT_VIEW_QUERY) {
  const viewMode = value.viewMode ?? fallback.viewMode;
  if (!VIEW_MODES.has(viewMode)) throw new Error(`View mode is unsupported: ${viewMode}`);
  return Object.freeze({ viewMode,
    coneDepth: normalizeViewDepth(value.coneDepth, fallback.coneDepth, 1),
    faninDepth: normalizeViewDepth(value.faninDepth, fallback.faninDepth),
    fanoutDepth: normalizeViewDepth(value.fanoutDepth, fallback.fanoutDepth)
  });
}
