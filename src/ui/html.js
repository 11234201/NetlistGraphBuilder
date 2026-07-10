export function renderDefinitionRows(rows) {
  return rows
    .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd><code>${escapeHtml(value)}</code></dd>`)
    .join("");
}

export function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return Number(value).toFixed(3);
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function escapeAttr(value) {
  return escapeHtml(value);
}
