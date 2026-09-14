const VIEW_MODES = new Set(["whole", "focused", "search-first"]);

export const DEFAULT_FOCUSED_VIEW_POLICY = Object.freeze({
  maximumRoots: 32,
  maximumVisibleNodes: 512,
  maximumFrontier: 1024
});

export function normalizeViewMode(value, fallback = "whole") {
  if (value === "fanin" || value === "fanout") return "focused";
  if (VIEW_MODES.has(value)) return value;
  return VIEW_MODES.has(fallback) ? fallback : "whole";
}

export function normalizeFocusedRootIds(value, legacyRootId = null, policy = DEFAULT_FOCUSED_VIEW_POLICY) {
  const values = Array.isArray(value) && value.length > 0
    ? value
    : value && !Array.isArray(value)
      ? [value]
      : legacyRootId
        ? [legacyRootId]
        : [];
  const maximumRoots = normalizeMaximumRoots(policy?.maximumRoots);
  return [...new Set(values.filter((id) => typeof id === "string" && id.length > 0))]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, maximumRoots);
}

export function normalizeMaximumRoots(value, fallback = DEFAULT_FOCUSED_VIEW_POLICY.maximumRoots) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.floor(number)) : fallback;
}
