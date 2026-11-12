export function createWorkbenchContextController({ document, windowTarget, readContext, closeLog }) {
  const get = (id) => document.getElementById(id);
  const removers = [];
  let frame = null;
  let disposed = false;
  const listen = (target, type, handler) => {
    target?.addEventListener(type, handler);
    removers.push(() => target?.removeEventListener(type, handler));
  };
  const text = (id, value) => {
    const element = get(id);
    if (element && element.textContent !== value) element.textContent = value;
  };
  const modeName = (mode) => mode === "search-first" ? "Search-first" : mode === "focused" || mode === "cone" ? "Focused" : "Whole";
  function refresh() {
    if (disposed) return;
    const context = readContext();
    const compare = context.compareActive;
    const title = compare ? `${context.leftModuleName || "A"} / ${context.rightModuleName || "B"}` : context.moduleLabel;
    text("workspaceTitle", title);
    get("workspaceTitle").title = title;
    text("workspaceMode", compare ? `A: ${modeName(context.leftMode)} · B: ${modeName(context.rightMode)}` : modeName(context.viewMode));
    const focused = get("focusedViewButton").classList.contains("is-active");
    if (!focused && get("focusedToolbar").contains(document.activeElement)) get("wholeViewButton").focus();
    get("focusedToolbar").hidden = !focused;
    text("focusedDepthScope", compare ? "Depths: both views" : "Depths: this view");
    const activeRoot = get("focusedRootsList").querySelector(".is-active");
    text("focusedRootPreview", activeRoot?.querySelector("[data-focused-root-activate]")?.textContent || activeRoot?.textContent?.replace(/×$/, "") || "Choose a cell and add a root");
    text("sourceBadge", context.sourceLabel);
    get("sourceBadge").title = context.sourceLabel;
    text("providerStatus", get("layoutProviderSelect").selectedOptions[0]?.textContent || "");
    get("compareNavigationNote").hidden = !compare;
    text("inspectorScope", compare ? (context.selectedSide === "right" ? "B" : context.selectedSide === "left" ? "A" : "Choose a side") : "Single");
    for (const side of document.querySelectorAll("[data-compare-side]")) side.classList.toggle("is-active-side", compare && side.dataset.compareSide === context.selectedSide);
    const draft = compare && (get("leftModuleSelect").value !== context.leftModuleName || get("rightModuleSelect").value !== context.rightModuleName);
    text("compareDraftStatus", draft ? "Not applied" : "");
    text("compareSyncSummary", `${get("syncCompareInput").checked ? "Pan/zoom linked" : "Pan/zoom independent"} · ${get("syncCompareFocusInput").checked ? "Roots linked" : "Roots independent"}`);
    const diagnostics = get("diagnosticsList");
    const count = /no diagnostics/i.test(diagnostics.textContent) ? 0 : diagnostics.children.length;
    text("diagnosticsCount", String(count));
  }
  function scheduleRefresh() {
    if (disposed || frame !== null) return;
    frame = windowTarget.requestAnimationFrame(() => { frame = null; refresh(); });
  }
  function toggleDiagnostics(open) {
    get("diagnosticsDrawer").hidden = !open;
    get("toggleDiagnosticsButton").setAttribute("aria-expanded", String(open));
    if (open) closeLog();
  }
  listen(get("toggleDiagnosticsButton"), "click", () => toggleDiagnostics(get("diagnosticsDrawer").hidden));
  listen(get("closeDiagnosticsButton"), "click", () => toggleDiagnostics(false));
  listen(get("closeProcessLogButton"), "click", closeLog);
  listen(get("toggleProcessLogButton"), "click", () => { if (!get("processLogList").hidden) toggleDiagnostics(false); });
  listen(document, "click", (event) => {
    const action = event.target.closest(".menu-action");
    // A file input's default picker action follows click dispatch. Keep its
    // disclosure rendered until selection/cancellation so the picker can open.
    if (action && !action.disabled && !action.querySelector("input[type=file]")) {
      const menu = action.closest("details.toolbar-menu");
      if (menu) menu.open = false;
    }
    scheduleRefresh();
  });
  listen(document, "change", scheduleRefresh);
  for (const input of document.querySelectorAll("label.menu-action input[type=file]")) {
    const closeImportMenu = () => {
      const menu = input.closest("details.toolbar-menu");
      if (!menu?.open) return;
      const restoreFocus = menu.contains(document.activeElement);
      menu.open = false;
      if (restoreFocus) menu.querySelector("summary")?.focus();
    };
    listen(input, "change", closeImportMenu);
    listen(input, "cancel", closeImportMenu);
  }
  listen(document, "keydown", (event) => {
    const label = event.target.closest("label[tabindex]");
    if (label && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      (label.htmlFor ? get(label.htmlFor) : label.querySelector("input[type=file]"))?.click();
    }
  });
  const observer = new windowTarget.MutationObserver(() => {
    if (!get("processLogList").hidden) toggleDiagnostics(false);
    scheduleRefresh();
  });
  for (const id of ["statusBar", "diagnosticsList", "focusedRootsList", "moduleHierarchyCurrent"]) {
    observer.observe(get(id), { childList: true, subtree: true, characterData: true });
  }
  observer.observe(get("focusedViewButton"), { attributes: true, attributeFilter: ["class"] });
  observer.observe(get("comparePanel"), { attributes: true, attributeFilter: ["hidden"] });
  observer.observe(get("processLogList"), { attributes: true, attributeFilter: ["hidden"] });
  refresh();
  return Object.freeze({
    refresh, scheduleRefresh,
    dispose() {
      disposed = true;
      observer.disconnect();
      if (frame !== null) windowTarget.cancelAnimationFrame(frame);
      for (const remove of removers) remove();
    }
  });
}
