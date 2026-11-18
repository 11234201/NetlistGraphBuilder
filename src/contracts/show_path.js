export const SHOW_PATH_POLICY = Object.freeze({
  maximumEndpoints: 32, maximumObjects: 400000, maximumReportedEndpoints: 4096, pageSize: 20
});

export function pathError(code, message) {
  return Object.assign(new Error(message), { code: "show-path." + code });
}

export function normalizeShowPath(value) {
  if (!value) return null;
  function side(keys = []) {
    if (!Array.isArray(keys) || keys.some((key) => typeof key !== "string" || !key)) {
      throw pathError("invalid-endpoint", "Choose an endpoint from the search results.");
    }
    const unique = [...new Set(keys)].sort();
    if (unique.length > SHOW_PATH_POLICY.maximumEndpoints) throw pathError("endpoint-limit",
      `Choose at most ${SHOW_PATH_POLICY.maximumEndpoints} endpoints on each side.`);
    return Object.freeze(unique);
  }
  const starts = side(value.starts), ends = side(value.ends);
  if (!starts.length && !ends.length) {
    if (value.enabled) throw pathError("empty-query", "Choose at least one start or end.");
    return null;
  }
  return Object.freeze({ enabled: value.enabled === true, starts, ends });
}

export function levelText(row) {
  const range = (min, max) => min === max ? String(min) : min + "…" + max;
  const remaining = row.distanceUnknown ? "unknown" : row.toTarget ? range(row.toTarget.min, row.toTarget.max) : "unreachable";
  const fromStart = row.min == null ? "—" : range(row.min, row.max);
  return row.distanceLabel + " " + remaining + " · From start " + fromStart + (row.partial ? " · partial" : "");
}
