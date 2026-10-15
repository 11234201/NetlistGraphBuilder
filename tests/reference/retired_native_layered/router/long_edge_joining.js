import { Simplify } from "./route_geometry.js";

/**
 * NLR-08 — long-edge join-back.
 *
 * A long logical edge was decomposed into adjacent-boundary hops during proper
 * layering. This module concatenates the per-gap geometry in chain order, drops
 * redundant collinear points, and restores the real source/target direction so
 * the published polyline still starts at the driver and ends at the load.
 */

export function JoinChainPolylines(polylines = []) {
  const points = [];
  for (const polyline of polylines) {
    for (const point of polyline) AppendPoint(points, point);
  }
  return Object.freeze(Simplify(points));
}

export function RestoreSemanticDirection(points = [], reversed = false) {
  return reversed ? Object.freeze([...points].reverse()) : Object.freeze(points);
}

function AppendPoint(points, point) {
  const previous = points.at(-1);
  if (!previous || Math.abs(previous.x - point.x) > 1e-6 || Math.abs(previous.y - point.y) > 1e-6) {
    points.push(Object.freeze({ x: point.x, y: point.y }));
  }
}
