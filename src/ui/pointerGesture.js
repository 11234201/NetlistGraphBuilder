export const DEFAULT_POINTER_DRAG_THRESHOLD = 3;

export function hasPointerDragged(start, current, threshold = DEFAULT_POINTER_DRAG_THRESHOLD) {
  const startX = Number(start?.x);
  const startY = Number(start?.y);
  const currentX = Number(current?.x);
  const currentY = Number(current?.y);
  if (![startX, startY, currentX, currentY].every(Number.isFinite)) return false;

  const minimumDistance = Math.max(0, Number(threshold) || 0);
  const deltaX = currentX - startX;
  const deltaY = currentY - startY;
  return deltaX * deltaX + deltaY * deltaY >= minimumDistance * minimumDistance;
}
