const EPSILON = 0.5;

export function compactOrthogonalPoints(points) {
  const unique = points.filter((point, index) => index === 0 ||
    point.x !== points[index - 1].x || point.y !== points[index - 1].y);
  return unique.filter((point, index) => {
    if (index === 0 || index === unique.length - 1) return true;
    const previous = unique[index - 1];
    const next = unique[index + 1];
    return !(
      (near(previous.x, point.x) && near(point.x, next.x)) ||
      (near(previous.y, point.y) && near(point.y, next.y))
    );
  });
}

export function getTargetApproachPoint(target, targetPoint, clearance = 8) {
  const side = getBoundarySide(target, targetPoint);
  if (side === "top") return { x: targetPoint.x, y: target.y - clearance };
  if (side === "bottom") {
    return { x: targetPoint.x, y: target.y + target.height + clearance };
  }
  return targetPoint;
}

export function routeFollowsEndpointSides(
  points,
  source,
  target,
  sourcePoint = points?.[0],
  targetPoint = points?.at(-1)
) {
  if (!Array.isArray(points) || points.length < 2 || !sourcePoint || !targetPoint) return false;
  return exitsBoundarySide(points[1], source, sourcePoint) &&
    entersBoundarySide(points.at(-2), target, targetPoint);
}

export function routePreservesEndpointAccess(points, source, target) {
  if (!Array.isArray(points) || points.length < 2) return false;
  const sourceBox = nodeBox(source);
  const targetBox = nodeBox(target);
  const lastSegment = points.length - 2;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (index !== 0 && orthogonalSegmentIntersectsBox(start, end, sourceBox)) return false;
    if (index !== lastSegment && orthogonalSegmentIntersectsBox(start, end, targetBox)) return false;
  }
  return true;
}

export function getRouteSegments(points, net) {
  const segments = [];
  for (let index = 0; index < (points?.length || 0) - 1; index += 1) {
    segments.push({ start: points[index], end: points[index + 1], net });
  }
  return segments;
}

export function countRouteConflicts(points, reservedSegments, net) {
  let conflicts = 0;
  for (const segment of getRouteSegments(points, net)) {
    const candidates = typeof reservedSegments.querySegment === "function"
      ? reservedSegments.querySegment(segment)
      : reservedSegments;
    for (const reserved of candidates) {
      if (reserved.net !== net && segmentsConflict(segment, reserved)) conflicts += 1;
    }
  }
  return conflicts;
}

export function segmentsConflict(left, right) {
  const leftHorizontal = near(left.start.y, left.end.y);
  const rightHorizontal = near(right.start.y, right.end.y);
  if (leftHorizontal && rightHorizontal) {
    return near(left.start.y, right.start.y) && rangesOverlapStrict(
      left.start.x, left.end.x, right.start.x, right.end.x
    );
  }
  if (!leftHorizontal && !rightHorizontal) {
    return near(left.start.x, right.start.x) && rangesOverlapStrict(
      left.start.y, left.end.y, right.start.y, right.end.y
    );
  }
  const horizontal = leftHorizontal ? left : right;
  const vertical = leftHorizontal ? right : left;
  return vertical.start.x > Math.min(horizontal.start.x, horizontal.end.x) &&
    vertical.start.x < Math.max(horizontal.start.x, horizontal.end.x) &&
    horizontal.start.y > Math.min(vertical.start.y, vertical.end.y) &&
    horizontal.start.y < Math.max(vertical.start.y, vertical.end.y);
}

export function collinearSegmentsOverlap(left, right) {
  const leftHorizontal = near(left.start.y, left.end.y);
  const rightHorizontal = near(right.start.y, right.end.y);
  if (leftHorizontal && rightHorizontal && near(left.start.y, right.start.y)) {
    return rangesOverlapStrict(left.start.x, left.end.x, right.start.x, right.end.x);
  }
  const leftVertical = near(left.start.x, left.end.x);
  const rightVertical = near(right.start.x, right.end.x);
  return leftVertical && rightVertical && near(left.start.x, right.start.x) &&
    rangesOverlapStrict(left.start.y, left.end.y, right.start.y, right.end.y);
}

export function orthogonalSegmentIntersectsBox(start, end, box) {
  if (near(start.y, end.y)) {
    return start.y >= box.top && start.y <= box.bottom &&
      Math.max(start.x, end.x) > box.left && Math.min(start.x, end.x) < box.right;
  }
  if (near(start.x, end.x)) {
    return start.x >= box.left && start.x <= box.right &&
      Math.max(start.y, end.y) > box.top && Math.min(start.y, end.y) < box.bottom;
  }
  return true;
}

export function segmentIntersectsBox(start, end, box) {
  let entry = 0;
  let exit = 1;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const boundaries = [
    [-dx, start.x - box.left],
    [dx, box.right - start.x],
    [-dy, start.y - box.top],
    [dy, box.bottom - start.y]
  ];
  for (const [direction, distance] of boundaries) {
    if (direction === 0) {
      if (distance < 0) return false;
      continue;
    }
    const ratio = distance / direction;
    if (direction < 0) entry = Math.max(entry, ratio);
    else exit = Math.min(exit, ratio);
    if (entry > exit) return false;
  }
  return true;
}

export function nodeBox(node, padding = 0) {
  return {
    left: node.x - padding,
    right: node.x + node.width + padding,
    top: node.y - padding,
    bottom: node.y + node.height + padding
  };
}

export function near(left, right) {
  return Math.abs(left - right) < EPSILON;
}

function getBoundarySide(node, point) {
  if (near(point.y, node.y) && inside(point.x, node.x, node.x + node.width)) return "top";
  if (
    near(point.y, node.y + node.height) &&
    inside(point.x, node.x, node.x + node.width)
  ) return "bottom";
  if (near(point.x, node.x) && inside(point.y, node.y, node.y + node.height)) return "left";
  if (
    near(point.x, node.x + node.width) &&
    inside(point.y, node.y, node.y + node.height)
  ) return "right";
  return null;
}

function exitsBoundarySide(next, node, point) {
  const side = getBoundarySide(node, point);
  // A source may leave tangentially along its boundary (for example an input
  // aligned above a top pin), but it must never turn back through the node.
  if (side === "top") return next.y <= point.y + EPSILON;
  if (side === "bottom") return next.y >= point.y - EPSILON;
  if (side === "left") return next.x <= point.x + EPSILON;
  if (side === "right") return next.x >= point.x - EPSILON;
  return true;
}

function entersBoundarySide(previous, node, point) {
  const side = getBoundarySide(node, point);
  if (side === "top") return near(previous.x, point.x) && previous.y < point.y;
  if (side === "bottom") return near(previous.x, point.x) && previous.y > point.y;
  if (side === "left") return near(previous.y, point.y) && previous.x < point.x;
  if (side === "right") return near(previous.y, point.y) && previous.x > point.x;
  return true;
}

function inside(value, minimum, maximum) {
  return value > minimum + EPSILON && value < maximum - EPSILON;
}

function rangesOverlapStrict(a1, a2, b1, b2) {
  return Math.min(Math.max(a1, a2), Math.max(b1, b2)) >
    Math.max(Math.min(a1, a2), Math.min(b1, b2));
}
