import { normalizeWorkbenchUiPreferences, WORKBENCH_PANEL_LIMITS } from "../contracts/workbench_ui_preferences.js";
import { createLatestFrameScheduler } from "./frameScheduler.js";
import { startPointerSession } from "./pointerSession.js";
import { createToolbarPopoverController } from "./toolbar_popover_controller.js";
import { isEditableWorkbenchTarget, normalizePanelWidth, resolveWorkbenchShellLayout } from "./workbench_shell_policy.js";

export function createWorkbenchShell({
  document,
  windowTarget = globalThis.window,
  preferences,
  onViewportResize = () => {},
  requestFrame,
  cancelFrame
}) {
  const shell = document.querySelector(".app-shell");
  const workspace = document.querySelector(".workspace");
  const elements = Object.fromEntries(["navigator", "inspector"].map((panel) => [panel, {
    panel: document.querySelector(`#${panel}Panel`),
    toggle: document.querySelector(`#toggle${panel[0].toUpperCase()}${panel.slice(1)}Button`),
    handle: document.querySelector(`#${panel}ResizeHandle`)
  }]));
  const tabs = [...document.querySelectorAll("[data-nav-tab]")];
  const navPanels = [...document.querySelectorAll("[data-nav-panel]")];
  const selectionButton = document.querySelector("#selectionSummaryButton");
  const helpDialog = document.querySelector("#helpDialog");
  const helpButton = document.querySelector("#helpButton");
  const hierarchyDisclosure = document.querySelector("#moduleHierarchyMenu");
  const removers = [];
  let prefs = normalizeWorkbenchUiPreferences(preferences?.load?.());
  let drawerPanel = null;
  let disposed = false;
  let activeResize = null;
  let layout = resolveWorkbenchShellLayout(windowTarget.innerWidth, prefs);
  const frameOptions = { requestFrame, cancelFrame };
  const popovers = createToolbarPopoverController({ document, windowTarget, ...frameOptions });
  const listen = (target, type, handler, options) => {
    target?.addEventListener(type, handler, options);
    removers.push(() => target?.removeEventListener(type, handler, options));
  };
  const save = () => preferences?.save?.({ ...prefs });

  function render(reason = "panel", preview = false, notify = true) {
    if (disposed) return;
    const next = resolveWorkbenchShellLayout(windowTarget.innerWidth, prefs, drawerPanel);
    const navigatorWasOpen = layout.navigator.open;
    if (notify) onViewportResize({ phase: "before", reason, preview });
    layout = next;
    for (const [panel, values] of Object.entries(layout)) {
      const group = elements[panel];
      for (const container of [shell, workspace]) {
        container?.setAttribute(`data-${panel}-open`, String(values.open));
        container?.setAttribute(`data-${panel}-mode`, values.mode);
        container?.style.setProperty(`--${panel}-width`, `${values.width}px`);
      }
      if (group.panel) {
        group.panel.hidden = !values.open;
        group.panel.inert = !values.open;
      }
      group.toggle?.setAttribute("aria-expanded", String(values.open));
      group.toggle?.setAttribute("aria-controls", `${panel}Panel`);
      const action = `${values.open ? "Hide" : "Show"} ${panel === "navigator" ? "Navigator" : "Inspector"}`;
      group.toggle?.setAttribute("aria-label", action);
      group.toggle?.setAttribute("title", action);
      if (group.handle) {
        group.handle.hidden = !values.open || values.mode === "drawer";
        group.handle.setAttribute("aria-valuenow", String(values.width));
        group.handle.setAttribute("aria-valuemin", String(WORKBENCH_PANEL_LIMITS[panel].min));
        group.handle.setAttribute("aria-valuemax", String(WORKBENCH_PANEL_LIMITS[panel].max));
      }
    }
    selectionButton?.setAttribute("aria-expanded", String(layout.inspector.open));
    selectionButton?.setAttribute("aria-controls", "inspectorPanel");
    if (hierarchyDisclosure) {
      if (!layout.navigator.open || prefs.navigatorTab !== "hierarchy") hierarchyDisclosure.open = false;
      else if (!navigatorWasOpen) hierarchyDisclosure.open = true;
    }
    if (notify) onViewportResize({ phase: "after", reason, preview });
    popovers.refresh();
  }

  function setPanelOpen(panel, open) {
    if (disposed || !elements[panel]) return;
    prefs[`${panel}Open`] = Boolean(open);
    if (layout[panel].mode === "drawer") drawerPanel = open ? panel : (drawerPanel === panel ? null : drawerPanel);
    if (!open && elements[panel].panel?.contains(document.activeElement)) elements[panel].toggle?.focus();
    render();
    save();
  }

  function selectNavigatorTab(tab, persist = true) {
    if (disposed || !["hierarchy", "design"].includes(tab)) return;
    prefs.navigatorTab = tab;
    for (const button of tabs) {
      const selected = button.getAttribute("data-nav-tab") === tab;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      button.classList.toggle("is-active", selected);
    }
    for (const panel of navPanels) panel.hidden = panel.getAttribute("data-nav-panel") !== tab;
    if (hierarchyDisclosure) hierarchyDisclosure.open = layout.navigator.open && tab === "hierarchy";
    if (persist) save();
  }

  const resizeFrame = createLatestFrameScheduler(({ panel, width }) => {
    prefs[`${panel}Width`] = normalizePanelWidth(panel, width);
    render("resize", true);
  }, frameOptions);

  function startResize(panel, event) {
    if (event.button !== 0 || disposed || layout[panel].mode !== "docked") return;
    event.preventDefault();
    activeResize?.({ type: "superseded" });
    const initialWidth = layout[panel].width;
    const initialX = event.clientX;
    activeResize = startPointerSession({
      target: elements[panel].handle,
      pointerId: event.pointerId,
      classTarget: workspace,
      className: "is-resizing-sidebar",
      onMove: (moveEvent) => resizeFrame.schedule({
        panel,
        width: initialWidth + (moveEvent.clientX - initialX) * (panel === "navigator" ? 1 : -1)
      }),
      onEnd: () => {
        activeResize = null;
        if (disposed) { resizeFrame.cancel(); return; }
        resizeFrame.flush();
        render("resize", false);
        save();
      }
    });
  }

  const viewportFrame = createLatestFrameScheduler(() => {
    const next = resolveWorkbenchShellLayout(windowTarget.innerWidth, prefs, drawerPanel);
    if (drawerPanel && next[drawerPanel].mode !== layout[drawerPanel].mode) drawerPanel = null;
    render("viewport");
  }, frameOptions);

  for (const [panel, group] of Object.entries(elements)) {
    listen(group.toggle, "click", () => setPanelOpen(panel, !layout[panel].open));
    listen(group.handle, "pointerdown", (event) => startResize(panel, event));
    listen(group.handle, "keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key) || layout[panel].mode !== "docked") return;
      event.preventDefault();
      const direction = (event.key === "ArrowRight" ? 1 : -1) * (panel === "navigator" ? 1 : -1);
      prefs[`${panel}Width`] = normalizePanelWidth(panel, layout[panel].width + direction * 16);
      render("resize");
      save();
    });
  }
  listen(selectionButton, "click", () => setPanelOpen("inspector", true));
  for (const button of document.querySelectorAll("[data-close-panel]")) {
    listen(button, "click", () => setPanelOpen(button.getAttribute("data-close-panel"), false));
  }
  for (const tab of tabs) {
    listen(tab, "click", () => selectNavigatorTab(tab.getAttribute("data-nav-tab")));
    listen(tab, "keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const current = tabs.indexOf(tab);
      const index = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      selectNavigatorTab(tabs[index].getAttribute("data-nav-tab"));
      tabs[index].focus();
    });
  }
  listen(windowTarget, "resize", () => viewportFrame.schedule());
  listen(document, "pointerdown", (event) => {
    if (!drawerPanel || helpDialog?.open) return;
    const { panel, toggle } = elements[drawerPanel];
    if (panel?.contains(event.target) || toggle?.contains(event.target) || selectionButton?.contains(event.target)) return;
    // An anchored toolbar popover may extend outside its owning drawer.
    if (event.target?.closest?.(".toolbar-menu-popover")) return;
    drawerPanel = null;
    render();
  });
  listen(helpButton, "click", () => { if (helpDialog && !helpDialog.open) helpDialog.showModal(); });
  listen(document.querySelector("#closeHelpButton"), "click", () => helpDialog?.close());
  listen(helpDialog, "close", () => helpButton?.focus());
  listen(document, "keydown", (event) => {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (document.querySelector("dialog[open]")) return;
    if (event.key === "Escape") {
      if (popovers.closeTop()) { event.preventDefault(); return; }
      if (drawerPanel) {
        const closed = drawerPanel;
        drawerPanel = null;
        render();
        elements[closed].toggle?.focus();
        event.preventDefault();
      }
    } else if (event.key === "/" && !isEditableWorkbenchTarget(event.target)) {
      const input = document.querySelector("#searchInput");
      if (!input || input.disabled) return;
      event.preventDefault();
      input.focus();
      input.select?.();
    }
  });

  render("initial", false, false);
  selectNavigatorTab(prefs.navigatorTab, false);
  return Object.freeze({
    refresh: () => render("viewport"),
    setPanelOpen,
    selectNavigatorTab,
    getPreferences: () => ({ ...prefs }),
    setInspectorTab(tab) {
      if (disposed || !["connections", "timing", "adjust"].includes(tab) || tab === prefs.inspectorTab) return;
      prefs.inspectorTab = tab;
      save();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      activeResize?.({ type: "dispose" });
      resizeFrame.cancel();
      viewportFrame.cancel();
      popovers.dispose();
      for (const remove of removers) remove();
    }
  });
}
