const SINGLE_VIEW_MODES = new Set(["whole", "focused", "search-first"]);

export function normalizeSingleViewMode(value, fallback = "whole") {
  if (value === "fanin" || value === "fanout") return "focused";
  if (SINGLE_VIEW_MODES.has(value)) return value;
  return SINGLE_VIEW_MODES.has(fallback) ? fallback : "whole";
}
