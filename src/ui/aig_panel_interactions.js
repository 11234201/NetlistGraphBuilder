const focusFields = ["aigFilter", "aigNavTab", "aigInspectorTab", "aigSelect", "aigZoom", "aigCopy", "aigShowSelection",
  "aigAnalysisSelect", "aigAnalysisCategory", "aigAnalysisPage", "aigAnalysisDetailPage", "aigAnalysisAction"];

export function createAigPanelInteractions({ document, navigatorHost, inspectorHost, onAction, onFilter }) {
  const hosts = [navigatorHost, inspectorHost];
  const filterValues = new Map();
  let composing = null, deferredRender = null;

  function filter(event) {
    const input = event.target;
    const field = input.dataset.aigFilter;
    if (!field || event.isComposing || composing === input || !navigatorHost.contains(input)) return;
    if (!filterValues.has(field) || filterValues.get(field) === input.value) return;
    filterValues.set(field, input.value);
    onFilter(field, input.value);
  }

  for (const host of hosts) {
    host.addEventListener("click", (event) => {
      const action = event.target.closest("button, input, select");
      if (action && !action.disabled) onAction(action.dataset);
    });
    host.addEventListener("change", filter);
    host.addEventListener("input", (event) => { if (event.target.type === "search") filter(event); });
    host.addEventListener("compositionstart", (event) => {
      if (event.target.dataset.aigFilter) composing = event.target;
    });
    host.addEventListener("compositionend", (event) => {
      if (composing !== event.target) return;
      composing = null;
      filter(event);
      if (deferredRender) render(deferredRender);
    });
    host.addEventListener("keydown", (event) => {
      const tab = event.target.closest('[role="tab"]');
      if (!tab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const tabs = [...tab.parentElement.querySelectorAll('[role="tab"]')];
      const index = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
        : (tabs.indexOf(tab) + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      const target = tabs[index], field = focusFields.find((key) => target.dataset[key] !== undefined), value = target.dataset[field];
      target.click();
      [...host.querySelectorAll('[role="tab"]')].find((element) => element.dataset[field] === value)?.focus();
    });
  }

  function render({ navigator, inspector }) {
    if (composing && navigatorHost.contains(composing)) { deferredRender = { navigator, inspector }; return; }
    deferredRender = null;
    const active = document.activeElement;
    const host = hosts.find((candidate) => candidate.contains(active));
    const restore = host ? captureFocus(host, active) : null;
    navigatorHost.innerHTML = navigator;
    inspectorHost.innerHTML = inspector;
    if (composing && !navigatorHost.contains(composing)) composing = null;
    for (const input of navigatorHost.querySelectorAll("[data-aig-filter]")) filterValues.set(input.dataset.aigFilter, input.value);
    restore?.();
  }
  function reset() {
    composing = null;
    deferredRender = null;
    filterValues.clear();
    for (const host of hosts) host.replaceChildren();
  }
  return Object.freeze({ render, reset });
}

function captureFocus(host, active) {
  const field = focusFields.find((key) => active.dataset?.[key] !== undefined);
  const pageTarget = active.dataset?.aigPageTarget;
  if (!field && !pageTarget) return null;
  const value = active.dataset[field];
  const matches = (element) => pageTarget ? element.dataset.aigPageTarget === pageTarget : element.dataset[field] === value;
  const ordinal = [...host.querySelectorAll("button, input, select")].filter(matches).indexOf(active);
  const start = active.selectionStart, end = active.selectionEnd;
  return () => {
    const controls = [...host.querySelectorAll("button, input, select")];
    const candidates = controls.filter(matches);
    let target = candidates[ordinal] || candidates[0];
    if (pageTarget && target?.disabled) target = candidates.find((element) => !element.disabled);
    if (!target && field === "aigShowSelection") target = controls.find((element) => element.dataset.aigSelect === value);
    target ||= host.querySelector('[role="tab"][aria-selected="true"]');
    target ||= controls.find((element) => element.dataset.aigAnalysisAction === "locate");
    target?.focus({ preventScroll: true });
    if (target?.type === "search" && start !== null) target.setSelectionRange(start, end);
  };
}
