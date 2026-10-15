/**
 * NLR-03 — Exact conflict oracle.
 *
 * This module reproduces ELK's `OrthogonalRoutingGenerator` dependency
 * semantics one for one: the same straight-segment skip, the same merge walk
 * with its critical and regular thresholds, the same crossing counts and the
 * same `CONFLICT_PENALTY`/`CROSSING_PENALTY` ratio.  It is the reference the
 * indexed production builder in `segment_dependencies.js` is measured against,
 * and it is deliberately capped to small boundaries in tests: the merge walk is
 * linear per pair but the oracle itself is all-pairs, which the repository
 * contract forbids in production.
 */

export const CRITICAL_CONFLICTS_DETECTED = -1;

export const DEFAULT_SEGMENT_CONFLICT_POLICY = Object.freeze({
  straightTolerance: 1e-3,
  conflictThresholdFactor: 0.5,
  criticalConflictThresholdFactor: 0.2,
  conflictPenalty: 1,
  crossingPenalty: 16,
  minimumAdjacentTapDistance: 1
});

export function ComputeThresholds(segments = [], options = {}) {
  const policy = { ...DEFAULT_SEGMENT_CONFLICT_POLICY, ...options };
  const edgeEdgeSpacing = Math.max(0, Number(options.edgeEdgeSpacing) || 0);
  const minimumAdjacent = Math.max(0, Number(options.minimumAdjacentTapDistance) ||
    policy.minimumAdjacentTapDistance);
  return Object.freeze({
    straightTolerance: Math.max(0, Number(policy.straightTolerance) || 0),
    conflictThreshold: policy.conflictThresholdFactor * edgeEdgeSpacing,
    criticalConflictThreshold: policy.criticalConflictThresholdFactor * minimumAdjacent,
    conflictPenalty: policy.conflictPenalty,
    crossingPenalty: policy.crossingPenalty
  });
}

export function IsStraight(segment, thresholds) {
  return Math.abs(segment.maximumY - segment.minimumY) < thresholds.straightTolerance;
}

export function CountConflicts(positionsA = [], positionsB = [], thresholds) {
  let conflicts = 0;
  if (positionsA.length === 0 || positionsB.length === 0) return conflicts;
  let indexA = 0;
  let indexB = 0;
  let positionA = positionsA[indexA];
  let positionB = positionsB[indexB];
  let hasMore = true;
  do {
    const distance = positionA - positionB;
    if (Math.abs(distance) < thresholds.criticalConflictThreshold) return CRITICAL_CONFLICTS_DETECTED;
    if (Math.abs(distance) < thresholds.conflictThreshold) conflicts += 1;
    if (positionA <= positionB && indexA + 1 < positionsA.length) {
      indexA += 1;
      positionA = positionsA[indexA];
    } else if (positionB <= positionA && indexB + 1 < positionsB.length) {
      indexB += 1;
      positionB = positionsB[indexB];
    } else {
      hasMore = false;
    }
  } while (hasMore);
  return conflicts;
}

export function CountCrossings(positions = [], start, end) {
  let crossings = 0;
  for (const position of positions) {
    if (position > end) break;
    if (position >= start) crossings += 1;
  }
  return crossings;
}

/**
 * Returns the dependencies ELK would create between two segments and how many
 * of them are critical.  A dependency is `{ sourceSegmentKey, targetSegmentKey,
 * critical, weight, reason }`; `source` must be ordered left of `target`.
 */
export function CreateDependencyIfNecessary(first, second, thresholds) {
  if (IsStraight(first, thresholds) || IsStraight(second, thresholds)) {
    return Object.freeze({ dependencies: Object.freeze([]), criticalDependencyCount: 0 });
  }
  const conflictsFirst = CountConflicts(first.outgoingY, second.incomingY, thresholds);
  const conflictsSecond = CountConflicts(second.outgoingY, first.incomingY, thresholds);
  const criticalFirst = conflictsFirst === CRITICAL_CONFLICTS_DETECTED;
  const criticalSecond = conflictsSecond === CRITICAL_CONFLICTS_DETECTED;
  const dependencies = [];
  let criticalDependencyCount = 0;

  if (criticalFirst || criticalSecond) {
    if (criticalFirst) {
      dependencies.push(MakeDependency(second.segmentKey, first.segmentKey, true, 0, "critical-conflict", 1));
      criticalDependencyCount += 1;
    }
    if (criticalSecond) {
      dependencies.push(MakeDependency(first.segmentKey, second.segmentKey, true, 0, "critical-conflict", 1));
      criticalDependencyCount += 1;
    }
    return Object.freeze({ dependencies: Object.freeze(dependencies), criticalDependencyCount });
  }

  const crossingsFirst = CountCrossings(first.outgoingY, second.minimumY, second.maximumY) +
    CountCrossings(second.incomingY, first.minimumY, first.maximumY);
  const crossingsSecond = CountCrossings(second.outgoingY, first.minimumY, first.maximumY) +
    CountCrossings(first.incomingY, second.minimumY, second.maximumY);
  const valueFirst = thresholds.conflictPenalty * conflictsFirst + thresholds.crossingPenalty * crossingsFirst;
  const valueSecond = thresholds.conflictPenalty * conflictsSecond + thresholds.crossingPenalty * crossingsSecond;

  if (valueFirst < valueSecond) {
    dependencies.push(MakeDependency(first.segmentKey, second.segmentKey, false,
      valueSecond - valueFirst, "crossing-preference", conflictsSecond));
  } else if (valueFirst > valueSecond) {
    dependencies.push(MakeDependency(second.segmentKey, first.segmentKey, false,
      valueFirst - valueSecond, "crossing-preference", conflictsFirst));
  } else if (valueFirst > 0) {
    // Equal cost in both directions: either order carries the same conflicts,
    // so neither direction can be a hard constraint.
    dependencies.push(MakeDependency(first.segmentKey, second.segmentKey, false, 0, "equal-cost", 0));
    dependencies.push(MakeDependency(second.segmentKey, first.segmentKey, false, 0, "equal-cost", 0));
  }
  return Object.freeze({ dependencies: Object.freeze(dependencies), criticalDependencyCount });
}

/** All-pairs oracle. Test-only for anything but tiny boundaries. */
export function BuildOracleDependencies(segments = [], thresholds) {
  const dependencies = [];
  let criticalDependencyCount = 0;
  for (let first = 0; first < segments.length - 1; first += 1) {
    for (let second = first + 1; second < segments.length; second += 1) {
      const result = CreateDependencyIfNecessary(segments[first], segments[second], thresholds);
      dependencies.push(...result.dependencies);
      criticalDependencyCount += result.criticalDependencyCount;
    }
  }
  return Object.freeze({
    dependencies: Object.freeze(Deduplicate(dependencies)),
    criticalDependencyCount
  });
}

export function Deduplicate(dependencies = []) {
  const byKey = new Map();
  for (const dependency of dependencies) {
    const key = DependencyKey(dependency);
    const existing = byKey.get(key);
    if (!existing || dependency.weight > existing.weight) byKey.set(key, dependency);
  }
  return [...byKey.values()].sort((left, right) => CompareText(DependencyKey(left), DependencyKey(right)));
}

export function DependencyKey(dependency) {
  return [dependency.sourceSegmentKey, dependency.targetSegmentKey, dependency.reason].join("\u0000");
}

/**
 * `conflicts` is the number of tap pairs that would lie on the same line if the
 * dependency were reversed, which is what makes the ordering worth paying for.
 * `hard` marks a dependency that prevents a real wire collision rather than
 * buying aesthetics: cycle breaking and slot numbering may drop or reverse a
 * preference, but only after every alternative has been spent.
 */
function MakeDependency(sourceSegmentKey, targetSegmentKey, critical, weight, reason, conflicts = 0) {
  return Object.freeze({
    sourceSegmentKey,
    targetSegmentKey,
    critical,
    weight,
    reason,
    conflicts,
    hard: critical === true || conflicts > 0
  });
}

function CompareText(left, right) {
  return String(left ?? "").localeCompare(String(right ?? ""));
}
