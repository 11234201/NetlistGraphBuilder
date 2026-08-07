import { escapeAttr, escapeHtml } from "./html.js";

export function renderProcessLogEntries(entries) {
  if (!entries.length) return `<li class="process-log-empty">No matching log entries</li>`;
  return entries.map((entry) => `<li class="process-log-entry level-${escapeAttr(entry.level)}"><time>${escapeHtml(formatTime(entry.timestamp))}</time><span class="process-log-level">${escapeHtml(entry.level)}</span><span class="process-log-phase">${escapeHtml(entry.phase)}</span><span class="process-log-message">${escapeHtml(entry.message)}</span>${entry.details ? `<details><summary>details</summary><pre>${escapeHtml(JSON.stringify(entry.details, null, 2))}</pre></details>` : ""}</li>`).join("");
}

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "--:--:--" : date.toLocaleTimeString([], { hour12: false });
}
