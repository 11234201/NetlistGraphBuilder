export function startPointerSession(options) {
  const {
    target,
    pointerId,
    classTarget = target,
    className,
    onMove,
    beforeEnd,
    onEnd
  } = options;
  if (!target) throw new TypeError("Pointer session target is required");

  let active = true;
  const belongs = (event) => event?.pointerId == null || event.pointerId === pointerId;
  const move = (event) => { if (active && belongs(event)) onMove?.(event); };
  const finish = (event) => {
    if (!active || !belongs(event)) return;
    active = false;
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", finish);
    target.removeEventListener("pointercancel", finish);
    target.removeEventListener("lostpointercapture", lostCapture);
    // Commit a queued preview while transient styling still applies. Cleanup
    // must precede onEnd, whose consumers may persist the completed gesture.
    try { beforeEnd?.(event); }
    finally {
      if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture?.(pointerId);
      if (className) classTarget?.classList.remove(className);
    }
    onEnd?.(event);
  };
  const lostCapture = (event) => { if (belongs(event)) finish({ type: "pointercancel", pointerId }); };

  target.setPointerCapture?.(pointerId);
  if (className) classTarget?.classList.add(className);
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", finish);
  target.addEventListener("pointercancel", finish);
  target.addEventListener("lostpointercapture", lostCapture);
  return finish;
}
