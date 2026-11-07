import { startPointerSession } from "../ui/pointerSession.js";

// Legacy workbench adapter. State and elements are restricted ports supplied
// by the composition root; peer actions are explicit, late-bound services.
export function createSidebarController({ state, elements, services }) {
  function startSidebarResize(event) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    startPointerSession({
      target: elements.sidebarResizeHandle,
      pointerId: event.pointerId,
      classTarget: elements.workspace,
      className: "is-resizing-sidebar",
      onMove: (moveEvent) => setSidebarWidth(
        moveEvent.clientX - elements.workspace.getBoundingClientRect().left
      )
    });
  }

  function handleSidebarResizeKeydown(event) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    const currentWidth = Number.parseFloat(getComputedStyle(elements.workspace).getPropertyValue("--sidebar-width")) || 300;
    setSidebarWidth(currentWidth + (event.key === "ArrowRight" ? 16 : -16));
  }

  function setSidebarWidth(width) {
    const maxWidth = Math.max(320, Math.min(640, elements.workspace.clientWidth - 320));
    const nextWidth = services.clamp(Math.round(width), 240, maxWidth);
    elements.workspace.style.setProperty("--sidebar-width", `${nextWidth}px`);
    elements.sidebarResizeHandle.setAttribute("aria-valuenow", String(nextWidth));
  }

  return Object.freeze({ startSidebarResize, handleSidebarResizeKeydown, setSidebarWidth });
}

export const sidebarPorts = Object.freeze({
  state: [

  ],
  elements: [
    "sidebarResizeHandle", "workspace"
  ],
  services: [
    "clamp"
  ]
});
