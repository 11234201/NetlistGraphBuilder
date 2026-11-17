import { startCanvasPan } from "./canvas_pan_controller.js";
import { createWheelGestureController } from "./wheel_gesture_controller.js";
import { cancelCanvasGestures } from "./canvas_gesture_lifecycle.js";
import { clientPointToViewBox, getSteppedZoomedTransform, getFocusedObjectTransform, formatViewportTransform } from "./viewport.js";

export function createDomainCanvas({ canvas, mount, readViewport, writeViewport, select, save }) {
  const getSvg = () => mount.querySelector("svg");
  let preview = null;
  let epoch = 0;
  let panning = false;
  let endPan = null;
  const cancelPan = () => { endPan?.({ type: "pointercancel" }); endPan = null; panning = false; };
  const read = () => preview || readViewport();
  const paint = (viewport) => {
    preview = viewport;
    getSvg()?.querySelector("#schematicContent")?.setAttribute("transform", formatViewportTransform(viewport));
  };
  const settle = () => { if (preview) writeViewport(preview); preview = null; save(); };
  const wheel = createWheelGestureController({ canvas, onSettled: settle, apply(sample) {
    if (sample.epoch !== epoch) return;
    const svg = getSvg();
    if (!svg) return;
    const box = svg.viewBox.baseVal;
    const rect = svg.getBoundingClientRect();
    const point = clientPointToViewBox({ x: sample.clientX, y: sample.clientY }, rect, box);
    paint(getSteppedZoomedTransform(read(), point, sample.steps, box.width, rect.width, 0.05, box.height, rect.height));
  } });
  // A following gesture consumes the last queued pan frame before advancing
  // its epoch. Pointer cleanup removes the gesture class before persistence.
  const finishPreview = () => { cancelPan(); wheel.flush(); if (preview) settle(); };
  const stop = () => { epoch += 1; cancelCanvasGestures(canvas); cancelPan(); wheel.cancel(); preview = null; };
  return Object.freeze({
    viewport: () => ({ ...read() }),
    preview(viewport) { stop(); paint({ ...viewport }); },
    apply() { stop(); paint(readViewport()); preview = null; },
    stop,
    wheel(event) {
      event.preventDefault();
      if (panning) { finishPreview(); epoch += 1; }
      wheel.queue({ mode: "domain", epoch, clientX: event.clientX, clientY: event.clientY, deltaY: event.deltaY });
    },
    pointerDown(event) {
      if (event.button !== 0) return;
      finishPreview();
      epoch += 1;
      const object = event.target.closest("[data-domain-object]");
      if (object) { select(object.dataset.domainObject, false); return; }
      const gestureEpoch = epoch;
      panning = startCanvasPan({ event, target: canvas, svg: getSvg(), readTransform: read, commit: (value) => { if (epoch === gestureEpoch) paint(value); },
        onSession(finish) { endPan = finish; },
        onEnd({ didPan, cancelled }) { endPan = null; if (epoch !== gestureEpoch) return; panning = false; settle(); if (!didPan && !cancelled) select(null, false); } });
    },
    fit() { stop(); paint({ x: 0, y: 0, scale: 1 }); settle(); },
    focus(bounds) {
      const svg = getSvg();
      if (!svg || !bounds) return;
      stop();
      const rect = svg.getBoundingClientRect();
      paint(getFocusedObjectTransform({ viewBox: svg.viewBox.baseVal, viewportWidth: rect.width,
        viewportHeight: rect.height, bounds, targetPixels: 180 }));
      settle();
    }
  });
}
