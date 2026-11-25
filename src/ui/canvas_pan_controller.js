import { createLatestFrameScheduler } from "./frameScheduler.js";
import { hasPointerDragged } from "./pointerGesture.js";
import { startPointerSession } from "./pointerSession.js";
import { schematicViewportRect, setVectorGesturePreview } from "./schematic_viewport.js";
import { getPannedTransform } from "./viewport.js";
import { registerCanvasGesture } from "./canvas_gesture_lifecycle.js";

const activePans = new WeakMap();

export function finishCanvasPan(target) {
  activePans.get(target)?.({ type: "pointercancel" });
}

export function startCanvasPan({ event, target, svg, transform, readTransform, commit, onEnd, onSession }) {
  if (!event || !target || !svg || typeof commit !== "function") return false;
  finishCanvasPan(target);
  // Finishing an earlier pan can commit its last queued frame. Read the new
  // origin afterwards, including when Compare uses independent viewports.
  const start = { ...clientPoint(event), transform: { ...(readTransform ? readTransform() : transform) } };
  let releaseGesture;
  let didPan = false;
  const frames = createLatestFrameScheduler((point) => {
    commit(getPannedTransform(
      start.transform,
      start,
      point,
      svg.viewBox.baseVal,
      schematicViewportRect(svg)
    ));
  });
  setVectorGesturePreview(target, "is-vector-panning", true);
  const finish = startPointerSession({
    target,
    pointerId: event.pointerId,
    className: "is-panning",
    onMove(moveEvent) {
      const point = clientPoint(moveEvent);
      didPan ||= hasPointerDragged(start, point);
      frames.schedule(point);
    },
    beforeEnd() {
      try { frames.flush(); }
      finally {
        if (activePans.get(target) === finish) activePans.delete(target);
        setVectorGesturePreview(target, "is-vector-panning", false);
        releaseGesture?.();
      }
    },
    onEnd(endEvent) {
      onEnd?.({ didPan, cancelled: endEvent?.type === "pointercancel" });
    }
  });
  activePans.set(target, finish);
  releaseGesture = registerCanvasGesture(target, () => {
    frames.cancel();
    finish({ type: "pointercancel" });
  });
  onSession?.(finish);
  return true;
}

function clientPoint(event) {
  const x = Number(event?.clientX);
  const y = Number(event?.clientY);
  return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
}
