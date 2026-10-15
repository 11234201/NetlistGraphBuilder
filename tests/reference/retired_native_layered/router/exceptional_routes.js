/**
 * NLR-09 — exceptional port directions.
 *
 * Self-loops and same-rank edges never enter the west-to-east segment
 * algorithm: they have no adjacent-boundary hops to route. They are handled by
 * named bounded adapters so the core stays free of hidden special cases. Both
 * adapters stay outside node boxes and produce at most five bends.
 */

export const DEFAULT_EXCEPTIONAL_POLICY = Object.freeze({
  escapeSpan: 24
});

export function BuildExceptionalRoute({ sourcePoint, targetPoint, source, target, selfLoop = false, policy = {} }) {
  const escape = Math.max(1, Number(policy.escapeSpan) || DEFAULT_EXCEPTIONAL_POLICY.escapeSpan);
  if (selfLoop && source) {
    const top = source.y - escape;
    const rightX = source.x + source.width + escape;
    const leftX = source.x - escape;
    return Object.freeze([
      Point(sourcePoint),
      Point({ x: rightX, y: sourcePoint.y }),
      Point({ x: rightX, y: top }),
      Point({ x: leftX, y: top }),
      Point({ x: leftX, y: targetPoint.y }),
      Point(targetPoint)
    ]);
  }
  const top = Math.min(sourcePoint.y, targetPoint.y) - escape;
  const sourceX = sourcePoint.x + (source ? escape : 0);
  const targetX = targetPoint.x - (target ? escape : 0);
  return Object.freeze([
    Point(sourcePoint),
    Point({ x: sourceX, y: sourcePoint.y }),
    Point({ x: sourceX, y: top }),
    Point({ x: targetX, y: top }),
    Point({ x: targetX, y: targetPoint.y }),
    Point(targetPoint)
  ]);
}

function Point(value) {
  return Object.freeze({ x: Round(value.x), y: Round(value.y) });
}

function Round(value) {
  return Math.round(Number(value) * 1000) / 1000;
}
