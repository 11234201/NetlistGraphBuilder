import { escapeAttr, escapeHtml } from "./html.js";

/** Render an explicit occurrence choice when a module definition is ambiguous. */
export function renderOccurrenceChoices(occurrences = [], moduleName = "") {
  const choices = (occurrences || []).filter((item) => item?.occurrencePath?.length);
  if (choices.length < 2) return "";
  const title = `Choose an occurrence context for ${moduleName || "this module"}`;
  const buttons = choices.map((occurrence) => {
    const path = occurrence.occurrencePath.join("/");
    const root = occurrence.rootModuleName || moduleName;
    const displayPath = occurrence.occurrencePath.join(" / ");
    const label = [root, displayPath].filter(Boolean).join(" / ");
    return `<button type="button" class="module-occurrence-choice" data-occurrence-module="${escapeAttr(occurrence.moduleName || moduleName)}" data-occurrence-root="${escapeAttr(root)}" data-occurrence-path="${escapeAttr(path)}" title="${escapeAttr(label)}"><span>${escapeHtml(label)}</span></button>`;
  }).join("");
  return `<section class="module-occurrence-choices-panel" aria-label="${escapeAttr(title)}"><strong>${escapeHtml(title)}</strong><div class="module-occurrence-choices">${buttons}</div></section>`;
}
