import { createLatestFrameScheduler } from "./frameScheduler.js";

const TAB_LABELS = Object.freeze({
  connections: "Connections",
  attributes: "Attributes",
  analysis: "Analysis",
  timing: "Timing",
  adjust: "Adjust"
});

export function createInspectorTabsController({
  container,
  sectionContent = {},
  summaryButton = null,
  scrollContainer = container,
  copyText,
  onCopyError = () => {},
  initialTab = "connections",
  onTabChange = () => {},
  MutationObserverClass = globalThis.MutationObserver,
  ResizeObserverClass = globalThis.ResizeObserver,
  requestFrame,
  cancelFrame
}) {
  if (!container) throw new Error("Inspector tabs require a content container");
  let activeTab = Object.hasOwn(TAB_LABELS, initialTab) ? initialTab : "connections";
  let preferredTab = activeTab;
  let identity = null;
  let scrollTop = 0;
  let disposed = false;
  let observedSummary = null;
  let summaryHeight = null;
  let pendingScroll = false;
  const fallbackMeasure = createLatestFrameScheduler(() => {
    if (disposed) return;
    const height = observedSummary?.getBoundingClientRect?.().height;
    restoreScroll();
    setSummaryHeight(height);
  }, { requestFrame, cancelFrame });
  const observer = MutationObserverClass ? new MutationObserverClass(refresh) : null;
  const summaryObserver = ResizeObserverClass ? new ResizeObserverClass((entries) => {
    if (disposed) return;
    const entry = entries.find((entry) => entry.target === observedSummary);
    if (!entry) return;
    // ResizeObserver runs after layout. Its border box includes summary padding
    // and borders, without forcing the newly replaced inspector/SVG to reflow.
    const box = entry.borderBoxSize?.[0] || entry.borderBoxSize;
    const height = box?.blockSize ?? observedSummary?.getBoundingClientRect?.().height;
    restoreScroll();
    setSummaryHeight(height);
  }) : null;
  const sections = () => [...container.querySelectorAll("[data-inspector-section]")];
  const observe = () => observer?.observe(container, { childList: true, subtree: true });

  function setSummaryHeight(height) {
    const nextHeight = Number.isFinite(height) ? Math.max(0, height) : 0;
    if (nextHeight === summaryHeight) return;
    summaryHeight = nextHeight;
    container.style?.setProperty("--inspector-summary-height", `${nextHeight}px`);
  }

  function trackSummary(summary) {
    summaryObserver?.disconnect();
    observedSummary = summary;
    pendingScroll = true;
    // Reobserve even an unchanged summary: a content refresh can clamp scrolling
    // without resizing the header. The next delivery restores it after layout.
    if (summary && summaryObserver) summaryObserver.observe(summary, { box: "border-box" });
    else if (summary) fallbackMeasure.schedule();
    else {
      fallbackMeasure.cancel();
      restoreScroll();
      setSummaryHeight(0);
    }
  }

  function restoreScroll() {
    if (!pendingScroll) return;
    scrollContainer.scrollTop = scrollTop;
    pendingScroll = false;
  }

  function refresh() {
    if (disposed) return;
    observer?.disconnect();
    const summary = container.querySelector("[data-inspector-summary]");
    const nextIdentity = summary?.dataset.selectionIdentity || null;
    if (nextIdentity !== identity) {
      identity = nextIdentity;
      scrollTop = 0;
    }
    const panels = sections();
    // Object selection replaces the section markup. Reattach independently
    // updated content (and its event handlers) to the new tab panel.
    for (const panel of panels) {
      const content = sectionContent[panel.dataset.inspectorSection];
      if (content && content.parentElement !== panel) panel.prepend(content);
    }
    if (summaryButton) {
      const label = summary?.querySelector("[data-selection-label]")?.textContent || "No selection";
      summaryButton.textContent = label;
      summaryButton.title = label;
    }
    let nav = container.querySelector("[data-inspector-tabs]");
    if (!panels.length) {
      nav?.remove();
      trackSummary(summary);
      observe();
      return;
    }
    activeTab = panels.some((panel) => panel.dataset.inspectorSection === preferredTab) ? preferredTab : "connections";
    if (!nav) {
      nav = container.ownerDocument.createElement("div");
      nav.className = "inspector-tabs";
      nav.dataset.inspectorTabs = "";
      nav.setAttribute("role", "tablist");
      nav.setAttribute("aria-label", "Object details");
      container.insertBefore(nav, panels[0]);
    }
    const prefix = container.id || "inspector";
    const buttons = panels.map((panel) => {
      const tab = panel.dataset.inspectorSection;
      if (!Object.hasOwn(TAB_LABELS, tab)) return "";
      panel.id = `${prefix}-panel-${tab}`;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", `${prefix}-tab-${tab}`);
      return `<button type="button" id="${prefix}-tab-${tab}" data-inspector-tab="${tab}" role="tab" aria-controls="${panel.id}">${TAB_LABELS[tab]}</button>`;
    }).join("");
    // Keep existing tab buttons (including keyboard focus) on panel-only updates.
    if (nav.dataset.tabSignature !== buttons) {
      nav.innerHTML = buttons;
      nav.dataset.tabSignature = buttons;
    }
    updateVisibility();
    trackSummary(summary);
    observe();
  }

  function updateVisibility() {
    for (const panel of sections()) panel.hidden = panel.dataset.inspectorSection !== activeTab;
    for (const button of container.querySelectorAll("[data-inspector-tab]")) {
      const selected = button.dataset.inspectorTab === activeTab;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      button.classList.toggle("is-active", selected);
    }
  }

  function selectTab(tab) {
    if (!sections().some((panel) => panel.dataset.inspectorSection === tab)) return false;
    if (activeTab !== tab || preferredTab !== tab) {
      preferredTab = tab;
      activeTab = tab;
      scrollTop = 0;
      updateVisibility();
      scrollContainer.scrollTop = 0;
      onTabChange(tab);
    }
    return true;
  }

  async function handleClick(event) {
    const tab = event.target.closest?.("[data-inspector-tab]");
    if (tab && container.contains(tab)) {
      selectTab(tab.dataset.inspectorTab);
      return;
    }
    const copy = event.target.closest?.("[data-inspector-copy]");
    if (!copy || !container.contains(copy)) return;
    const status = container.querySelector("[data-inspector-copy-status]");
    const selectionIdentity = identity;
    try {
      if (typeof copyText !== "function") throw new Error("Clipboard unavailable");
      await copyText(copy.dataset.inspectorCopy);
      if (status && container.contains(status)) status.textContent = "Canonical name copied.";
    } catch (error) {
      if (disposed || selectionIdentity !== identity) return;
      if (status && container.contains(status)) status.textContent = "Copy unavailable. Select the name to copy it manually.";
      try { onCopyError({ error, selectionIdentity, operation: "inspector.copy", code: "CLIPBOARD_WRITE_FAILED" }); }
      catch { /* The manual-copy fallback also works when the diagnostic sink is unavailable. */ }
    }
  }

  function handleKeydown(event) {
    const current = event.target.closest?.("[data-inspector-tab]");
    if (!current || !container.contains(current) || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = [...container.querySelectorAll("[data-inspector-tab]")];
    const index = buttons.indexOf(current);
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault();
    selectTab(buttons[nextIndex].dataset.inspectorTab);
    buttons[nextIndex].focus();
  }

  function handleScroll() { if (!pendingScroll) scrollTop = scrollContainer.scrollTop; }
  container.addEventListener("click", handleClick);
  container.addEventListener("keydown", handleKeydown);
  scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
  refresh();
  return Object.freeze({
    refresh,
    selectTab,
    dispose() {
      disposed = true;
      observer?.disconnect();
      summaryObserver?.disconnect();
      fallbackMeasure.cancel();
      observedSummary = null;
      container.style?.removeProperty("--inspector-summary-height");
      container.removeEventListener("click", handleClick);
      container.removeEventListener("keydown", handleKeydown);
      scrollContainer.removeEventListener("scroll", handleScroll);
    }
  });
}
