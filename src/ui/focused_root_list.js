import { escapeAttr, escapeHtml } from "./html.js";
import { captureFocusedRootsFocus } from "./focused_roots_focus.js";

export function createFocusedRootList({ elements, readContext, readRefs, readOccurrence, netNameForRoot }) {
  let focusedRootsQuery = "";
  function handleFocusedRootsFilter(event) {
    focusedRootsQuery = String(event.target.value || "").trim().toLocaleLowerCase();
    renderFocusedRootList();
  }

  function renderFocusedRootList() {
    if (!elements.focusedRootsList || !elements.focusedRootCount) return;
    const restoreFocus = captureFocusedRootsFocus(elements.focusedRootsList);
    const context = readContext();
    const roots = context.roots;
    elements.focusedRootCount.value = String(roots.length);
    elements.focusedRootCount.textContent = String(roots.length);
    if (roots.length === 0) {
      elements.focusedRootsList.textContent = "No roots";
      restoreFocus();
      return;
    }
    elements.focusedRootsList.innerHTML = roots.map((nodeId, rootIndex) => {
      const rootRef = readRefs(context.side)?.[rootIndex];
      const netName = netNameForRoot(nodeId);
      const node = context.fullGraph?.nodes.find((item) => item.id === nodeId);
      const canonicalNetName = rootRef?.kind === "net" ? rootRef.localId : netName;
      const localLabel = canonicalNetName ? `net ${canonicalNetName}` : node?.label || rootRef?.localId || nodeId.replace(/^cell:/, "");
      const occurrencePath = rootRef?.occurrencePath?.join("/") || node?.ref?.occurrencePath?.join("/") ||
        (netName && !context.compare ? readOccurrence()?.join("/") : "") || "";
      const label = occurrencePath ? `${occurrencePath} · ${localLabel}` : localLabel;
      if (focusedRootsQuery && !`${nodeId} ${label}`.toLocaleLowerCase().includes(focusedRootsQuery)) return "";
      const activeClass = nodeId === context.activeRootNodeId ? " is-active" : "";
      const sideLabel = context.compare ? `${context.side === "left" ? "A" : "B"}: ` : "";
      const title = `${sideLabel}${occurrencePath ? `${occurrencePath} / ` : ""}${localLabel}`;
      return `<span class="focused-root-chip${activeClass}" title="${escapeAttr(title)}"><button type="button" class="focused-root-activate" aria-pressed="${nodeId === context.activeRootNodeId}" data-focused-root-activate="${escapeAttr(nodeId)}"><span>${sideLabel}${escapeHtml(label)}</span></button><button type="button" aria-label="Remove ${escapeAttr(label)} from Focused roots" data-focused-root-remove="${escapeAttr(nodeId)}">×</button></span>`;
    }).join("") || "No matching roots";
    restoreFocus();
  }

  return { renderFocusedRootList, handleFocusedRootsFilter };
}
