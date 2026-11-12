const TAB_LABELS = Object.freeze({ connections: "Connections", timing: "Timing", adjust: "Adjust" });

export function createInspectorTabsController({
  container,
  summaryButton = null,
  scrollContainer = container,
  copyText,
  initialTab = "connections",
  onTabChange = () => {},
  MutationObserverClass = globalThis.MutationObserver,
  ResizeObserverClass = globalThis.ResizeObserver
}) {
  if (!container) throw new Error("Inspector tabs require a content container");
  let activeTab = Object.hasOwn(TAB_LABELS, initialTab) ? initialTab : "connections";
  let identity = null;
  let scrollTop = 0;
  let disposed = false;
  let observedSummary = null;
  let summaryHeight = null;
  const observer = MutationObserverClass ? new MutationObserverClass(refresh) : null;
  const summaryObserver = ResizeObserverClass ? new ResizeObserverClass((entries) => {
    if (!disposed && entries.some((entry) => entry.target === observedSummary)) measureSummary();
  }) : null;
  const sections = () => [...container.querySelectorAll("[data-inspector-section]")];
  const observe = () => observer?.observe(container, { childList: true, subtree: true });

  function measureSummary() {
    const height = observedSummary?.getBoundingClientRect?.().height;
    const nextHeight = Number.isFinite(height) ? Math.max(0, height) : 0;
    if (nextHeight === summaryHeight) return;
    summaryHeight = nextHeight;
    container.style?.setProperty("--inspector-summary-height", `${nextHeight}px`);
  }

  function trackSummary(summary) {
    if (summary !== observedSummary) {
      summaryObserver?.disconnect();
      observedSummary = summary;
      if (summary) summaryObserver?.observe(summary);
    }
    measureSummary();
  }

  function refresh() {
    if (disposed) return;
    observer?.disconnect();
    const summary = container.querySelector("[data-inspector-summary]");
    trackSummary(summary);
    const nextIdentity = summary?.dataset.selectionIdentity || null;
    if (nextIdentity !== identity) {
      identity = nextIdentity;
      scrollTop = 0;
    }
    const panels = sections();
    if (summaryButton) {
      const label = summary?.querySelector("[data-selection-label]")?.textContent || "No selection";
      summaryButton.textContent = label;
      summaryButton.title = label;
    }
    let nav = container.querySelector("[data-inspector-tabs]");
    if (!panels.length) {
      nav?.remove();
      scrollContainer.scrollTop = scrollTop;
      observe();
      return;
    }
    if (!panels.some((panel) => panel.dataset.inspectorSection === activeTab)) activeTab = "connections";
    if (!nav) {
      nav = container.ownerDocument.createElement("div");
      nav.className = "inspector-tabs";
      nav.dataset.inspectorTabs = "";
      nav.setAttribute("role", "tablist");
      nav.setAttribute("aria-label", "Object details");
      container.insertBefore(nav, panels[0]);
    }
    const prefix = container.id || "inspector";
    nav.innerHTML = panels.map((panel) => {
      const tab = panel.dataset.inspectorSection;
      if (!Object.hasOwn(TAB_LABELS, tab)) return "";
      panel.id = `${prefix}-panel-${tab}`;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", `${prefix}-tab-${tab}`);
      return `<button type="button" id="${prefix}-tab-${tab}" data-inspector-tab="${tab}" role="tab" aria-controls="${panel.id}">${TAB_LABELS[tab]}</button>`;
    }).join("");
    updateVisibility();
    scrollContainer.scrollTop = scrollTop;
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
    if (activeTab !== tab) {
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
    try {
      if (typeof copyText !== "function") throw new Error("Clipboard unavailable");
      await copyText(copy.dataset.inspectorCopy);
      if (status && container.contains(status)) status.textContent = "Canonical name copied.";
    } catch {
      if (status && container.contains(status)) status.textContent = "Copy unavailable. Select the name to copy it manually.";
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

  function handleScroll() { scrollTop = scrollContainer.scrollTop; }
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
      observedSummary = null;
      container.style?.removeProperty("--inspector-summary-height");
      container.removeEventListener("click", handleClick);
      container.removeEventListener("keydown", handleKeydown);
      scrollContainer.removeEventListener("scroll", handleScroll);
    }
  });
}
