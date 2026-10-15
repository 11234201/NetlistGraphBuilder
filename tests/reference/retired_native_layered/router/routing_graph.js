import { getConnectionPoint } from "../../../../src/layout/nodeGeometry.js";

/**
 * NLR-01 — Boundary routing IR.
 *
 * The routing graph is immutable at the phase boundary and is addressed by
 * adjacent-layer boundary rather than by public edge array position.  A tap is
 * one end of one proper-layer hop; the hop is the only unit that later becomes
 * geometry, and dummies never reach the UI.
 */

export const DEFAULT_ROUTING_GRAPH_POLICY = Object.freeze({
  straightTolerance: 1e-3,
  minimumAdjacentTapDistance: 1
});

export function BuildAnchorChains(proper, orientation, nodeByKey) {
  const chains = new Map();
  for (const edge of orientation.edges) {
    if (edge.ignoredForLayering) continue;
    const chain = proper.chains.find((entry) => entry.edgeKey === edge.key);
    if (!chain) continue;
    const sourceRole = edge.reversedForLayout ? "target" : "source";
    const targetRole = edge.reversedForLayout ? "source" : "target";
    const leftPin = edge.reversedForLayout ? edge.targetPin : edge.sourcePin;
    const rightPin = edge.reversedForLayout ? edge.sourcePin : edge.targetPin;
    const left = Endpoint(nodeByKey.get(edge.layoutSourceKey), leftPin, sourceRole);
    const right = Endpoint(nodeByKey.get(edge.layoutTargetKey), rightPin, targetRole);
    const middles = chain.dummyKeys.map((key) => Endpoint(nodeByKey.get(key), null, "dummy"));
    if (!left || !right || middles.some((point) => !point)) continue;
    chains.set(edge.key, Object.freeze({
      edgeKey: edge.key,
      physicalNetKey: edge.physicalNetKey,
      dummyKeys: chain.dummyKeys,
      points: Object.freeze([left, ...middles, right])
    }));
  }
  return chains;
}

export function BuildBoundaryRoutingGraph(proper, orientation, anchorChains, policy = {}) {
  const tolerance = Math.max(0, Number(policy.straightTolerance) ||
    DEFAULT_ROUTING_GRAPH_POLICY.straightTolerance);
  const tapsByBoundary = new Map();
  const diagnostics = [];
  const orientedEdgeByKey = new Map(orientation.edges.map((edge) => [edge.key, edge]));

  for (const chain of [...anchorChains.values()].sort((left, right) => CompareText(left.edgeKey, right.edgeKey))) {
    const edge = orientedEdgeByKey.get(chain.edgeKey);
    if (!edge) continue;
    const points = chain.points;
    for (let index = 0; index < points.length - 1; index += 1) {
      const left = points[index];
      const right = points[index + 1];
      const boundary = Number(left.rank);
      if (!Number.isFinite(boundary)) {
        diagnostics.push(Object.freeze({
          code: "native-router-missing-rank",
          edgeKey: chain.edgeKey,
          hopIndex: index
        }));
        continue;
      }
      const tap = Object.freeze({
        hopKey: `hop:${chain.edgeKey}:${index}`,
        logicalEdgeKey: chain.edgeKey,
        physicalNetKey: chain.physicalNetKey,
        boundary,
        hopIndex: index,
        leftKey: left.key,
        rightKey: right.key,
        leftRole: left.role,
        rightRole: right.role,
        leftPin: left.pin,
        rightPin: right.pin,
        leftY: left.y,
        rightY: right.y
      });
      const values = tapsByBoundary.get(boundary) || [];
      values.push(tap);
      tapsByBoundary.set(boundary, values);
    }
  }

  const boundaries = [...tapsByBoundary.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([boundary, taps]) => Object.freeze({
      boundary,
      taps: Object.freeze(taps.sort(CompareTaps))
    }));

  return Object.freeze({
    boundaries: Object.freeze(boundaries),
    tolerance,
    diagnostics: Object.freeze(diagnostics)
  });
}

/**
 * ELK's `minimumHorizontalSegmentDistance`: the smallest gap between two
 * adjacent coordinates inside one segment's own incoming or outgoing tap set.
 * Sets with fewer than two taps contribute nothing, and an empty boundary falls
 * back to the configured default so the critical threshold stays finite.
 */
export function MinimumAdjacentTapDistance(segments = []) {
  let minimum = Infinity;
  for (const segment of segments) {
    for (const values of [segment.incomingY, segment.outgoingY]) {
      for (let index = 1; index < values.length; index += 1) {
        minimum = Math.min(minimum, values[index] - values[index - 1]);
      }
    }
  }
  return Number.isFinite(minimum) ? Math.max(0, minimum) : DEFAULT_ROUTING_GRAPH_POLICY.minimumAdjacentTapDistance;
}

function Endpoint(node, pin, role) {
  if (!node) return null;
  if (role === "dummy") {
    return Object.freeze({
      key: node.key,
      role,
      pin: null,
      rank: node.rank,
      x: node.x + node.width / 2,
      y: node.y + node.height / 2
    });
  }
  const point = getConnectionPoint(node, pin, role);
  if (!point) return null;
  return Object.freeze({
    key: node.key,
    role,
    pin: pin ?? null,
    rank: node.rank,
    x: Number(point.x) || 0,
    y: Number(point.y) || 0
  });
}

function CompareTaps(left, right) {
  return left.boundary - right.boundary ||
    CompareText(left.physicalNetKey, right.physicalNetKey) ||
    CompareText(left.logicalEdgeKey, right.logicalEdgeKey) ||
    left.hopIndex - right.hopIndex;
}

function CompareText(left, right) {
  return String(left ?? "").localeCompare(String(right ?? ""));
}
