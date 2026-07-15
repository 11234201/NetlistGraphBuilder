export function startPointerSession(options) {
  const {
    target,
    pointerId,
    classTarget = target,
    className,
    onMove,
    onEnd
  } = options;
  if (!target) throw new TypeError("Pointer session target is required");

  let active = true;
  const move = (event) => onMove?.(event);
  const finish = (event) => {
    if (!active) return;
    active = false;
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", finish);
    target.removeEventListener("pointercancel", finish);
    if (className) classTarget?.classList.remove(className);
    onEnd?.(event);
  };

  target.setPointerCapture?.(pointerId);
  if (className) classTarget?.classList.add(className);
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", finish);
  target.addEventListener("pointercancel", finish);
  return finish;
}
