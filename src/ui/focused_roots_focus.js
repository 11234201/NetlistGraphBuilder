// Capture only focus owned by the roots list. Selection updates elsewhere must
// never pull keyboard focus into a disclosure or away from a text field.
export function captureFocusedRootsFocus(list) {
  const document = list?.ownerDocument;
  const active = document?.activeElement;
  const button = active?.closest?.("[data-focused-root-activate], [data-focused-root-remove]");
  if (!button || !list.contains(button)) return () => {};
  const action = button.dataset.focusedRootRemove !== undefined ? "focusedRootRemove" : "focusedRootActivate";
  const rootId = button.dataset[action];
  const originalRoots = [...list.querySelectorAll("[data-focused-root-activate]")];
  const originalIndex = originalRoots.findIndex((item) => item.dataset.focusedRootActivate === rootId);
  return () => {
    const exact = [...list.querySelectorAll("[data-focused-root-activate], [data-focused-root-remove]")]
      .find((item) => item.dataset[action] === rootId);
    const roots = [...list.querySelectorAll("[data-focused-root-activate]")];
    const neighbor = roots[Math.min(Math.max(originalIndex, 0), roots.length - 1)];
    const fallback = document.getElementById("focusedRootsFilter");
    const summary = document.getElementById("focusedRootsMenu")?.querySelector("summary");
    const target = [exact, neighbor, fallback, summary].find((item) =>
      item && !item.disabled && !item.closest?.("[hidden], [inert]"));
    target?.focus({ preventScroll: true });
  };
}
