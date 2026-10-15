/**
 * NLR-02 — Hyperedge segment construction.
 *
 * One physical net owns one shared trunk per boundary.  Branch taps of the same
 * net join that trunk instead of competing for independent lanes, which is what
 * turns a 139-load control net into a single visible structure per boundary.
 * Physical-net identity is driver based, so two nets that merely share a label
 * never merge.
 */

export const DEFAULT_SEGMENT_POLICY = Object.freeze({
  straightTolerance: 1e-3
});

export function BuildHyperedgeSegments(boundaryGraph, policy = {}) {
  const tolerance = Math.max(0, Number(policy.straightTolerance) || DEFAULT_SEGMENT_POLICY.straightTolerance);
  const boundaries = boundaryGraph.boundaries.map((boundary) => {
    const groups = new Map();
    for (const tap of boundary.taps) {
      const values = groups.get(tap.physicalNetKey) || [];
      values.push(tap);
      groups.set(tap.physicalNetKey, values);
    }
    const segments = [...groups.entries()]
      .sort((left, right) => CompareText(left[0], right[0]))
      .map(([physicalNetKey, taps]) => MakeSegment(boundary.boundary, physicalNetKey, taps, tolerance));
    return Object.freeze({
      boundary: boundary.boundary,
      segments: Object.freeze(segments)
    });
  });
  const segmentByKey = new Map();
  for (const boundary of boundaries) {
    for (const segment of boundary.segments) segmentByKey.set(segment.segmentKey, segment);
  }
  return Object.freeze({
    boundaries: Object.freeze(boundaries),
    segmentByKey,
    tolerance,
    segmentCount: segmentByKey.size
  });
}

function MakeSegment(boundary, physicalNetKey, taps, tolerance) {
  const incomingY = Object.freeze(taps.map((tap) => tap.leftY).sort((left, right) => left - right));
  const outgoingY = Object.freeze(taps.map((tap) => tap.rightY).sort((left, right) => left - right));
  const minimumY = Math.min(...incomingY, ...outgoingY);
  const maximumY = Math.max(...incomingY, ...outgoingY);
  return Object.freeze({
    segmentKey: `segment:${boundary}:${physicalNetKey}`,
    physicalNetKey,
    boundary,
    hopKeys: Object.freeze([...taps].sort(CompareTaps).map((tap) => tap.hopKey)),
    incomingY,
    outgoingY,
    minimumY,
    maximumY,
    straight: Math.abs(maximumY - minimumY) < tolerance,
    // ELK's `representsHyperedge`: more than one incoming plus outgoing tap.
    representsHyperedge: incomingY.length + outgoingY.length > 2,
    splitPartnerKey: null
  });
}

function CompareTaps(left, right) {
  return CompareText(left.logicalEdgeKey, right.logicalEdgeKey) || left.hopIndex - right.hopIndex;
}

function CompareText(left, right) {
  return String(left ?? "").localeCompare(String(right ?? ""));
}
