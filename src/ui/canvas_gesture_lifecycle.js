// UI gesture resources belong to the canvas, even when different workspaces
// temporarily use that same element. Replacement discards queued input;
// ordinary gesture takeover can still flush its final frame explicitly.
const activeGestures = new WeakMap();

export function registerCanvasGesture(canvas, cancel) {
  let gestures = activeGestures.get(canvas);
  if (!gestures) activeGestures.set(canvas, gestures = new Set());
  gestures.add(cancel);
  return () => {
    gestures.delete(cancel);
    if (!gestures.size && activeGestures.get(canvas) === gestures) activeGestures.delete(canvas);
  };
}

export function cancelCanvasGestures(element) {
  const canvas = element?.closest?.(".canvas") || element;
  const gestures = activeGestures.get(canvas);
  if (!gestures) return;
  activeGestures.delete(canvas);
  const errors = [];
  for (const cancel of [...gestures]) {
    try { cancel(); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, "Canvas gesture cancellation failed");
}
