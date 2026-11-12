import { createCanvasResizeController } from "../ui/canvas_resize_controller.js";

export function createWorkbenchViewportBridge({
  readViews, singleViewSession, compareViewSessions, applyTransform, applyCompareTransforms,
  windowTarget, requestFrame, cancelFrame, ResizeObserverClass, MutationObserverClass
}) {
  return createCanvasResizeController({
    readViews, windowTarget, requestFrame, cancelFrame, ResizeObserverClass, MutationObserverClass,
    commit(id, viewport) {
      // Resizing preserves physical magnification, so it also preserves the
      // current LOD. Legacy transform adapters derive LOD from raw scale and
      // the Compare adapter repaints both sides on either side's commit.
      const detailHosts = new Map();
      for (const view of readViews() || []) {
        const host = view.mount?.closest?.(view.id === "single" ? ".canvas" : ".compare-side");
        if (host?.classList) detailHosts.set(host, host.classList.contains("is-low-detail"));
      }
      const command = { type: "viewport.set", viewport, recordHistory: false };
      try {
        if (id === "single") {
          singleViewSession.dispatch(command);
          applyTransform(false);
        } else if (id === "left" || id === "right") {
          compareViewSessions.dispatch(id, command);
          applyCompareTransforms();
        } else {
          throw new Error(`Unknown canvas viewport: ${id}`);
        }
      } finally {
        for (const [host, lowDetail] of detailHosts) host.classList.toggle("is-low-detail", lowDetail);
      }
    }
  });
}
