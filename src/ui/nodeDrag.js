export const DEFAULT_NODE_DRAG_MARGIN = 16;

export function getDraggedNodePosition(
  startPosition,
  startPointer,
  currentPointer,
  minimum = DEFAULT_NODE_DRAG_MARGIN
) {
  return {
    x: round(Math.max(minimum, startPosition.x + currentPointer.x - startPointer.x)),
    y: round(Math.max(minimum, startPosition.y + currentPointer.y - startPointer.y))
  };
}

export function sameNodePosition(left, right) {
  return left?.x === right?.x && left?.y === right?.y;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
