import { createLatestFrameScheduler } from "./frameScheduler.js";
import { closeDisclosuresOutside, closeOtherDisclosures } from "./disclosure.js";

export function fitPopoverToViewport(anchor, size, viewport, gap = 6, margin = 8) {
  const width = Math.min(size.width, Math.max(0, viewport.width - margin * 2));
  const below = Math.max(0, viewport.height - anchor.bottom - gap - margin);
  const above = Math.max(0, anchor.top - gap - margin);
  const upwards = size.height > below && above > below;
  const maxHeight = upwards ? above : below;
  return {
    left: Math.max(margin, Math.min(anchor.left, viewport.width - margin - width)),
    top: upwards ? Math.max(margin, anchor.top - gap - Math.min(size.height, maxHeight)) : anchor.bottom + gap,
    maxWidth: Math.max(0, viewport.width - margin * 2),
    maxHeight
  };
}

export function createToolbarPopoverController({ document, windowTarget, requestFrame, cancelFrame }) {
  const menus = [...document.querySelectorAll(".toolbar-menu")];
  const removers = [];
  let disposed = false;
  const listen = (target, type, handler, options) => {
    target?.addEventListener(type, handler, options);
    removers.push(() => target?.removeEventListener(type, handler, options));
  };
  const position = () => {
    if (disposed) return;
    for (const menu of menus) {
      if (!menu.open) continue;
      const summary = menu.querySelector("summary");
      const popover = menu.querySelector(".toolbar-menu-popover");
      if (!summary || !popover) continue;
      popover.style.setProperty("position", "fixed");
      popover.style.setProperty("right", "auto");
      popover.style.setProperty("bottom", "auto");
      const fitted = fitPopoverToViewport(summary.getBoundingClientRect(), popover.getBoundingClientRect(), {
        width: windowTarget.innerWidth,
        height: windowTarget.innerHeight
      });
      for (const [property, value] of Object.entries({ left: fitted.left, top: fitted.top, "max-width": fitted.maxWidth, "max-height": fitted.maxHeight })) {
        popover.style.setProperty(property, `${value}px`);
      }
      popover.style.setProperty("overflow", "auto");
    }
  };
  const scheduler = createLatestFrameScheduler(position, { requestFrame, cancelFrame });
  for (const menu of menus) listen(menu, "toggle", () => {
    if (!menu.open) return;
    closeOtherDisclosures(menus, menu);
    position();
  });
  listen(document, "pointerdown", (event) => closeDisclosuresOutside(menus, event.target));
  listen(windowTarget, "resize", () => scheduler.schedule());
  listen(document, "scroll", () => scheduler.schedule(), true);
  return Object.freeze({
    refresh: position,
    closeTop() {
      const menu = menus.findLast((entry) => entry.open);
      if (!menu) return false;
      menu.open = false;
      menu.querySelector("summary")?.focus();
      return true;
    },
    dispose() {
      disposed = true;
      scheduler.cancel();
      for (const remove of removers) remove();
      for (const menu of menus) {
        const popover = menu.querySelector(".toolbar-menu-popover");
        for (const property of ["position", "right", "bottom", "left", "top", "max-width", "max-height", "overflow"]) {
          popover?.style.removeProperty(property);
        }
      }
    }
  });
}
