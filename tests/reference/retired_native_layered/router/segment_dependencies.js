import { MINIMUM_FOREIGN_WIRE_SEPARATION } from "../../../../src/layout/orthogonalRouting.js";
import {
  ComputeThresholds,
  CreateDependencyIfNecessary,
  Deduplicate
} from "./segment_conflicts.js";
import { MinimumAdjacentTapDistance } from "./routing_graph.js";

/**
 * NLR-04 — Indexed dependency builder.
 *
 * ELK compares every pair of segments in a boundary.  This builder reaches the
 * same pairs through two narrow indexes instead:
 *
 * 1. coordinate buckets sized by the critical threshold, which find every pair
 *    whose taps can collide badly enough to need a hard ordering constraint;
 * 2. an interval sweep over trunk extents with a bounded active-neighbour
 *    window, which finds the pairs whose crossings decide the soft direction.
 *
 * Every surviving candidate is then scored by the exact oracle, so the
 * predicates are never approximated — only the candidate set is. Both indexes
 * report their bounds instead of silently exceeding them.
 */

export const DEFAULT_DEPENDENCY_POLICY = Object.freeze({
  maximumActiveCandidates: 32,
  maximumBucketCandidates: 64,
  straightTolerance: 1e-3,
  conflictThresholdFactor: 0.5,
  criticalConflictThresholdFactor: 0.2,
  conflictPenalty: 1,
  crossingPenalty: 16
});

export function BuildSegmentDependencies(segments = [], options = {}) {
  const policy = NormalizePolicy(options);
  const thresholds = ComputeThresholds(segments, {
    ...policy,
    edgeEdgeSpacing: options.edgeEdgeSpacing,
    minimumAdjacentTapDistance: MinimumAdjacentTapDistance(segments)
  });
  const candidates = new Map();
  const diagnostics = [];
  let maximumActiveCandidates = 0;
  let truncated = false;

  const nearPairs = DiscoverCriticalCandidates(segments, thresholds, policy);
  if (nearPairs.truncated) {
    truncated = true;
    diagnostics.push(Object.freeze({
      code: "native-router-critical-bucket-truncated",
      boundary: options.boundary ?? null,
      limit: policy.maximumBucketCandidates
    }));
  }
  for (const pair of nearPairs.pairs) AddCandidate(candidates, pair.left, pair.right);

  const sweep = DiscoverOverlapCandidates(segments, policy);
  maximumActiveCandidates = Math.max(nearPairs.maximumBucket, sweep.maximumActive);
  if (sweep.truncated) {
    truncated = true;
    diagnostics.push(Object.freeze({
      code: "native-router-active-candidates-truncated",
      boundary: options.boundary ?? null,
      limit: policy.maximumActiveCandidates
    }));
  }
  for (const pair of sweep.pairs) AddCandidate(candidates, pair.left, pair.right);

  const byKey = new Map(segments.map((segment) => [segment.segmentKey, segment]));
  const dependencies = [];
  let criticalDependencyCount = 0;
  for (const [leftKey, rightKeys] of [...candidates.entries()].sort((a, b) => CompareText(a[0], b[0]))) {
    for (const rightKey of [...rightKeys].sort(CompareText)) {
      const first = byKey.get(leftKey);
      const second = byKey.get(rightKey);
      if (!first || !second) continue;
      const result = CreateDependencyIfNecessary(first, second, thresholds);
      dependencies.push(...result.dependencies);
      criticalDependencyCount += result.criticalDependencyCount;
    }
  }

  return Object.freeze({
    dependencies: Object.freeze(Deduplicate(dependencies)),
    criticalDependencyCount,
    thresholds,
    metrics: Object.freeze({
      segmentCount: segments.length,
      candidateCount: CountPairs(candidates),
      maximumActiveCandidates,
      dependencyCount: dependencies.length,
      criticalDependencyCount,
      truncated
    }),
    diagnostics: Object.freeze(diagnostics)
  });
}

/**
 * Exact tap-overlap constraints.
 *
 * ELK's `countConflicts` walks two sorted coordinate lists with a single merge
 * pass, so it only inspects the pairs the frontier happens to align. A tap pair
 * one pixel apart can sit off that frontier and be counted as no conflict at
 * all, while the validator — which treats parallel wires closer than
 * `MINIMUM_FOREIGN_WIRE_SEPARATION` as overlapping — still reports it.
 *
 * This pass answers the same question exactly, and only for the pairs where an
 * ordering can actually help. Within one boundary, an incoming tap runs from
 * its port to its own trunk and an outgoing tap runs from its own trunk to its
 * port, so for two different nets at the same y:
 *
 *   incoming(A) against outgoing(B) overlaps exactly when trunkB < trunkA, and
 *   A must therefore be placed at or left of B.
 *
 * Both remaining combinations cannot be fixed by ordering: two incoming taps
 * share the left end of the boundary and two outgoing taps share the right end,
 * so they overlap whichever way the trunks are ordered. Those pairs are left to
 * the splitter, which is the only thing that can separate them.
 *
 * Cost is a sweep over two sorted lists, not a product of them: the inner loop
 * only walks the taps inside the separation window, and the window is capped.
 */
export function BuildTapOverlapConstraints(segments = [], options = {}) {
  const separation = Math.max(0, Number(options.minimumWireSeparation) ||
    MINIMUM_FOREIGN_WIRE_SEPARATION);
  const incoming = [];
  const outgoing = [];
  const netByKey = new Map(segments.map((segment) => [segment.segmentKey, segment.physicalNetKey]));
  for (const segment of segments) {
    for (const y of segment.incomingY) incoming.push({ y, key: segment.segmentKey });
    for (const y of segment.outgoingY) outgoing.push({ y, key: segment.segmentKey });
  }
  incoming.sort((left, right) => left.y - right.y || CompareText(left.key, right.key));
  outgoing.sort((left, right) => left.y - right.y || CompareText(left.key, right.key));

  const directions = new Map();
  let truncated = false;
  let start = 0;
  for (const tap of incoming) {
    while (start < outgoing.length && outgoing[start].y < tap.y - separation) start += 1;
    for (let index = start; index < outgoing.length && outgoing[index].y <= tap.y + separation; index += 1) {
      const other = outgoing[index];
      // Branches of one physical net share their trunk, so their taps never
      // collide. A split makes that visible: the two halves are separate
      // segments of the same net and meet at the bridge coordinate.
      if (other.key === tap.key) continue;
      if (netByKey.get(other.key) === netByKey.get(tap.key)) continue;
      const key = `${tap.key}\u0000${other.key}`;
      const entry = directions.get(key) || { source: tap.key, target: other.key, forward: false, backward: false };
      entry.forward = true;
      directions.set(key, entry);
      const reverse = directions.get(`${other.key}\u0000${tap.key}`);
      if (reverse) reverse.backward = true;
    }
  }

  const dependencies = [];
  for (const entry of directions.values()) {
    // Both directions demanded means ordering cannot separate the two trunks;
    // mark it critical so the splitter, not the slot numbering, owns it.
    const both = entry.forward && entry.backward;
    dependencies.push(Object.freeze({
      sourceSegmentKey: entry.source,
      targetSegmentKey: entry.target,
      critical: both,
      // A one-way exact tap constraint is the geometry safety rule itself,
      // not a crossing preference. Keep it until every approximate conflict
      // edge in the cycle has been spent.
      weight: both ? 0 : Number.MAX_SAFE_INTEGER,
      reason: both ? "tap-overlap-critical" : "tap-overlap",
      conflicts: 1,
      hard: true
    }));
    if (!both) continue;
    dependencies.push(Object.freeze({
      sourceSegmentKey: entry.target,
      targetSegmentKey: entry.source,
      critical: true,
      weight: 0,
      reason: "tap-overlap-critical",
      conflicts: 1,
      hard: true
    }));
  }

  return Object.freeze({
    dependencies: Object.freeze(Deduplicate(dependencies)),
    truncated
  });
}

/**
 * Critical conflicts are always cross-side: ELK compares one segment's incoming
 * taps with another segment's outgoing taps. Buckets therefore hold one entry
 * per *segment*, not per tap — counting taps let a single high-fanout net fill
 * the window and hide real pairs behind it.
 */
function DiscoverCriticalCandidates(segments, thresholds, policy) {
  const radius = Math.max(thresholds.criticalConflictThreshold, thresholds.conflictThreshold, 1e-6);
  const outgoingBuckets = new Map();
  for (const segment of segments) {
    for (const y of segment.outgoingY) {
      const bucket = BucketOf(y, radius);
      const values = outgoingBuckets.get(bucket) || new Set();
      values.add(segment.segmentKey);
      outgoingBuckets.set(bucket, values);
    }
  }
  const pairs = new Set();
  let maximumBucket = 0;
  let truncated = false;
  for (const segment of segments) {
    for (const y of segment.incomingY) {
      const bucket = BucketOf(y, radius);
      for (const key of [bucket - 1, bucket, bucket + 1]) {
        const values = outgoingBuckets.get(key);
        if (!values) continue;
        maximumBucket = Math.max(maximumBucket, values.size);
        if (values.size > policy.maximumBucketCandidates) truncated = true;
        const window = [...values].sort(CompareText).slice(0, policy.maximumBucketCandidates);
        for (const other of window) {
          if (other === segment.segmentKey) continue;
          const pair = Pair(segment.segmentKey, other);
          pairs.add(`${pair.left}\u0000${pair.right}`);
        }
      }
    }
  }
  const result = [];
  for (const key of [...pairs].sort(CompareText)) {
    const [left, right] = key.split("\u0000");
    result.push({ left, right });
  }
  return { pairs: result, maximumBucket, truncated };
}

function BucketOf(y, radius) {
  return Math.floor(y / radius);
}

function DiscoverOverlapCandidates(segments, policy) {
  const ordered = [...segments].sort((left, right) =>
    left.minimumY - right.minimumY || CompareText(left.segmentKey, right.segmentKey));
  const active = [];
  const pairs = [];
  let maximumActive = 0;
  let truncated = false;
  for (const segment of ordered) {
    for (let index = active.length - 1; index >= 0; index -= 1) {
      if (active[index].maximumY < segment.minimumY) active.splice(index, 1);
    }
    active.push(segment);
    const others = active.filter((entry) => entry.segmentKey !== segment.segmentKey);
    maximumActive = Math.max(maximumActive, others.length);
    if (others.length > policy.maximumActiveCandidates) truncated = true;
    const window = others
      .map((entry) => ({ entry, distance: Math.max(0, segment.minimumY - entry.maximumY, entry.minimumY - segment.maximumY) }))
      .sort((left, right) => left.distance - right.distance || CompareText(left.entry.segmentKey, right.entry.segmentKey))
      .slice(0, policy.maximumActiveCandidates);
    for (const candidate of window) pairs.push(Pair(segment.segmentKey, candidate.entry.segmentKey));
  }
  return { pairs, maximumActive, truncated };
}

function Pair(left, right) {
  return left.localeCompare(right) <= 0 ? { left, right } : { left: right, right: left };
}

function AddCandidate(candidates, left, right) {
  const values = candidates.get(left) || new Set();
  values.add(right);
  candidates.set(left, values);
}

function CountPairs(candidates) {
  let total = 0;
  for (const values of candidates.values()) total += values.size;
  return total;
}

function NormalizePolicy(options) {
  const number = (value, fallback, minimum) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(minimum, Math.floor(parsed)) : fallback;
  };
  return {
    maximumActiveCandidates: number(options.maximumActiveCandidates,
      DEFAULT_DEPENDENCY_POLICY.maximumActiveCandidates, 1),
    maximumBucketCandidates: number(options.maximumBucketCandidates,
      DEFAULT_DEPENDENCY_POLICY.maximumBucketCandidates, 1),
    straightTolerance: DEFAULT_DEPENDENCY_POLICY.straightTolerance,
    conflictThresholdFactor: DEFAULT_DEPENDENCY_POLICY.conflictThresholdFactor,
    criticalConflictThresholdFactor: DEFAULT_DEPENDENCY_POLICY.criticalConflictThresholdFactor,
    conflictPenalty: DEFAULT_DEPENDENCY_POLICY.conflictPenalty,
    crossingPenalty: DEFAULT_DEPENDENCY_POLICY.crossingPenalty
  };
}

function CompareText(left, right) {
  return String(left ?? "").localeCompare(String(right ?? ""));
}
