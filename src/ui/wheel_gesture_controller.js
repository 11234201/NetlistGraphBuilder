import { createLatestFrameScheduler } from "./frameScheduler.js";
import { setVectorGesturePreview } from "./schematic_viewport.js";
import { finishCanvasPan } from "./canvas_pan_controller.js";
import { registerCanvasGesture } from "./canvas_gesture_lifecycle.js";

export function createWheelGestureController({ canvas, apply, onSettled, settleDelay = 140, schedulerFactory = createLatestFrameScheduler, timers = globalThis }) {
  if (!canvas || typeof apply !== "function") throw new Error("Wheel gesture controller requires canvas and apply port");
  let pending = null;
  let settleTimer = null;
  let generation = 0;
  let interacting = false;
  let releaseGesture = null;
  function settle(token) {
    if (token !== generation || pending) return;
    frames.flush();
    setInteracting(false);
    releaseOwnership();
    onSettled?.();
  }
  // A compositor stall can let an idle timer fire while the browser still has
  // wheel events awaiting presentation. Allow queued input to supersede this
  // settlement across the next paint before committing history and persistence.
  const confirmPaint = schedulerFactory(({ token, presented }) => {
    if (token !== generation) return;
    if (presented) settle(token);
    else confirmPaint.schedule({ token, presented: true });
  });
  // Start the quiet interval after the last zoom frame has been presented. A
  // slow SVG frame must not spend the interval and restore details while the
  // next wheel input is already waiting to be dispatched.
  const afterPaint = schedulerFactory((token) => {
    if (token !== generation || pending) return;
    settleTimer = timers.setTimeout(() => {
      if (token !== generation) return;
      settleTimer = null;
      if (canvas.querySelector?.("svg[data-composited-viewport]")) confirmPaint.schedule({ token, presented: false });
      else settle(token);
    }, settleDelay);
  });
  const frames = schedulerFactory((sample) => {
    if (pending === sample) pending = null;
    try { apply(sample); }
    catch (error) { cancel(); throw error; }
    afterPaint.schedule(generation);
  });

  function setInteracting(value) {
    if (interacting === value) return;
    interacting = value;
    setVectorGesturePreview(canvas, "is-vector-zooming", value);
    canvas.classList[value ? "add" : "remove"]("is-view-interacting");
  }

  function cancelSettlement() {
    generation += 1;
    timers.clearTimeout(settleTimer);
    settleTimer = null;
    afterPaint.cancel();
    confirmPaint.cancel();
  }

  function queue(sample) {
    finishCanvasPan(canvas);
    cancelSettlement();
    releaseGesture ||= registerCanvasGesture(canvas, cancel);
    const sameTarget = pending && pending.mode === sample.mode && pending.side === sample.side;
    if (sameTarget) {
      pending.clientX = sample.clientX;
      pending.clientY = sample.clientY;
      pending.steps += sample.deltaY < 0 ? -1 : 1;
    } else {
      frames.flush();
      pending = { ...sample, steps: sample.deltaY < 0 ? -1 : 1 };
    }
    setInteracting(true);
    frames.schedule(pending);
  }

  function releaseOwnership() {
    releaseGesture?.();
    releaseGesture = null;
  }

  function cancel() {
    cancelSettlement();
    frames.cancel();
    pending = null;
    setInteracting(false);
    releaseOwnership();
  }

  return Object.freeze({
    queue,
    cancel,
    flush() {
      cancelSettlement();
      frames.flush();
      afterPaint.cancel();
      setInteracting(false);
      releaseOwnership();
    }
  });
}
