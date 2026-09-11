import { createLatestFrameScheduler } from "./frameScheduler.js";
import { hasPointerDragged } from "./pointerGesture.js";
import { startPointerSession } from "./pointerSession.js";
import { getPannedTransform } from "./viewport.js";

export function startCanvasPan({ event, target, svg, transform, commit, onEnd }) {
  if (!event || !target || !svg || typeof commit !== "function") return false;
  const start = { ...clientPoint(event), transform: { ...transform } };
  let didPan = false;
  const frames = createLatestFrameScheduler((point) => {
    commit(getPannedTransform(
      start.transform,
      start,
      point,
      svg.viewBox.baseVal,
      svg.getBoundingClientRect()
    ));
  });
  startPointerSession({
    target,
    pointerId: event.pointerId,
    className: "is-panning",
    onMove(moveEvent) {
      const point = clientPoint(moveEvent);
      didPan ||= hasPointerDragged(start, point);
      frames.schedule(point);
    },
    onEnd(endEvent) {
      frames.flush();
      onEnd?.({ didPan, cancelled: endEvent?.type === "pointercancel" });
    }
  });
  return true;
}

function clientPoint(event) {
  const x = Number(event?.clientX);
  const y = Number(event?.clientY);
  return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
}
