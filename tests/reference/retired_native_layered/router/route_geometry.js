/**
 * NLR-07 — shared-trunk geometry.
 *
 * One physical net owns one vertical trunk per boundary. Every branch of that
 * net taps the trunk with a horizontal segment from its exact port coordinate,
 * so a 139-load control net is one visible line with taps rather than 139
 * independently chosen detours. Split segments add a single horizontal bridge
 * between their two trunks at the chosen free y coordinate.
 *
 * There is no candidate list: geometry is derived from the allocated slot and
 * the committed split plan, and failure means an upstream constraint failed.
 */

export const DEFAULT_GEOMETRY_POLICY = Object.freeze({
  straightTolerance: 1e-3
});

export function BuildHopPolyline(hop, policy = {}) {
  const tolerance = Math.max(0, Number(policy.straightTolerance) || DEFAULT_GEOMETRY_POLICY.straightTolerance);
  const points = [];
  Append(points, hop.leftPoint);
  if (hop.straight) {
    Append(points, hop.rightPoint);
    return Object.freeze(Simplify(points));
  }
  const bridgeX = hop.bridgeX ?? null;
  const bridgeY = hop.bridgeY ?? null;
  const firstX = hop.trunkX;
  Append(points, { x: firstX, y: hop.leftPoint.y });
  if (bridgeX !== null && bridgeY !== null) {
    Append(points, { x: firstX, y: bridgeY });
    Append(points, { x: bridgeX, y: bridgeY });
    Append(points, { x: bridgeX, y: hop.rightPoint.y });
  } else {
    Append(points, { x: firstX, y: hop.rightPoint.y });
  }
  Append(points, hop.rightPoint);
  void tolerance;
  return Object.freeze(Simplify(points));
}

export function BuildJunctionPoints(segments = [], trunkXBySegmentKey, tapsBySegmentKey) {
  const junctions = [];
  for (const segment of segments) {
    const trunkX = trunkXBySegmentKey.get(segment.segmentKey);
    if (trunkX === undefined || segment.straight) continue;
    const taps = tapsBySegmentKey.get(segment.segmentKey) || [];
    for (const tap of taps) {
      junctions.push(Object.freeze({
        segmentKey: segment.segmentKey,
        physicalNetKey: segment.physicalNetKey,
        x: trunkX,
        y: tap.y
      }));
    }
  }
  return Object.freeze(junctions
    .sort((left, right) => left.x - right.x || left.y - right.y || CompareText(left.physicalNetKey, right.physicalNetKey)));
}

function Append(points, point) {
  const previous = points.at(-1);
  if (!previous || Math.abs(previous.x - point.x) > 1e-6 || Math.abs(previous.y - point.y) > 1e-6) {
    points.push(Object.freeze({ x: Round(point.x), y: Round(point.y) }));
  }
}

export function Simplify(points) {
  const result = [];
  for (const point of points) {
    const previous = result.at(-1);
    const before = result.at(-2);
    if (before && previous && IsCollinear(before, previous, point)) {
      result[result.length - 1] = point;
    } else {
      result.push(point);
    }
  }
  return result;
}

function IsCollinear(first, second, third) {
  return (Math.abs(first.x - second.x) < 1e-6 && Math.abs(second.x - third.x) < 1e-6) ||
    (Math.abs(first.y - second.y) < 1e-6 && Math.abs(second.y - third.y) < 1e-6);
}

function Round(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function CompareText(left, right) {
  return String(left ?? "").localeCompare(String(right ?? ""));
}
