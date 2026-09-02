export const DEFAULT_FOCUSED_VIEW_POLICY = Object.freeze({
  maximumRoots: 32
});

export function normalizeFocusedRootNodeIds(value, legacyRootNodeId = null, policy = DEFAULT_FOCUSED_VIEW_POLICY) {
  const values = Array.isArray(value) && value.length > 0
    ? value
    : value && !Array.isArray(value)
      ? [value]
      : legacyRootNodeId
        ? [legacyRootNodeId]
        : [];
  const maximumRoots = normalizeMaximumRoots(policy?.maximumRoots);
  return [...new Set(values.filter((nodeId) => typeof nodeId === "string" && nodeId.length > 0))]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, maximumRoots);
}

export function normalizeMaximumRoots(value, fallback = DEFAULT_FOCUSED_VIEW_POLICY.maximumRoots) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.floor(number)) : fallback;
}

