import { createLatestFrameScheduler } from "./frameScheduler.js";

export function createWheelGestureController({ canvas, apply, onSettled, settleDelay = 140, schedulerFactory = createLatestFrameScheduler, timers = globalThis }) {
  if (!canvas || typeof apply !== "function") throw new Error("Wheel gesture controller requires canvas and apply port");
  let pending = null;
  let settleTimer = null;
  const frames = schedulerFactory((sample) => {
    if (pending === sample) pending = null;
    apply(sample);
  });

  function queue(sample) {
    const sameTarget = pending && pending.mode === sample.mode && pending.side === sample.side;
    if (sameTarget) {
      pending.clientX = sample.clientX;
      pending.clientY = sample.clientY;
      pending.steps += sample.deltaY < 0 ? -1 : 1;
    } else {
      frames.flush();
      pending = { ...sample, steps: sample.deltaY < 0 ? -1 : 1 };
    }
    canvas.classList.add("is-view-interacting");
    timers.clearTimeout(settleTimer);
    settleTimer = timers.setTimeout(() => {
      frames.flush();
      canvas.classList.remove("is-view-interacting");
      onSettled?.();
    }, settleDelay);
    frames.schedule(pending);
  }

  return Object.freeze({
    queue,
    flush() {
      frames.flush();
      timers.clearTimeout(settleTimer);
      settleTimer = null;
      canvas.classList.remove("is-view-interacting");
    }
  });
}
