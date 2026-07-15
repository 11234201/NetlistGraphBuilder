export function collectLocalLaneYs({
  sourceY,
  targetY,
  nodes = [],
  segments = [],
  padding = 8
}) {
  return uniqueRoundedNumbers([
    sourceY,
    targetY,
    (sourceY + targetY) / 2,
    ...nodes.flatMap((node) => [node.y - padding, node.y + node.height + padding]),
    ...segments.flatMap((segment) => [
      Math.min(segment.start.y, segment.end.y) - padding,
      Math.max(segment.start.y, segment.end.y) + padding
    ])
  ]).toSorted((left, right) =>
    localLaneCost(left, sourceY, targetY) - localLaneCost(right, sourceY, targetY) ||
    left - right);
}

export function queryReservedSegments(reservedSegments, box, net) {
  if (!reservedSegments) return [];
  const candidates = typeof reservedSegments.queryBox === "function"
    ? reservedSegments.queryBox(box)
    : Array.from(reservedSegments).filter((segment) => segmentIntersectsBox(segment, box));
  return candidates.filter((segment) => segment.net !== net);
}

export function uniqueRoundedNumbers(values) {
  return [...new Set(values
    .filter(Number.isFinite)
    .map((value) => Math.round(value * 1000) / 1000))];
}

function localLaneCost(laneY, sourceY, targetY) {
  return Math.abs(laneY - sourceY) + Math.abs(laneY - targetY);
}

function segmentIntersectsBox(segment, box) {
  return Math.max(segment.start.x, segment.end.x) >= box.left &&
    Math.min(segment.start.x, segment.end.x) <= box.right &&
    Math.max(segment.start.y, segment.end.y) >= box.top &&
    Math.min(segment.start.y, segment.end.y) <= box.bottom;
}
