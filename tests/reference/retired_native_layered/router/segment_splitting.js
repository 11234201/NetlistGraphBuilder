import { CreateDependencyIfNecessary, Deduplicate } from "./segment_conflicts.js";
import { FindCyclicComponents } from "./segment_cycle_breaking.js";
import { MINIMUM_FOREIGN_WIRE_SEPARATION } from "../../../../src/layout/orthogonalRouting.js";

/**
 * NLR-05 — critical segment splitting.
 *
 * A critical cycle means two segments would lay a horizontal tap on top of
 * another segment's tap no matter which order they take. ELK resolves it by
 * splitting one involved segment into two trunks joined through a free y
 * interval. Two details of ELK's `HyperEdgeSegmentSplitter` are load bearing:
 *
 * - the split segment loses **all** of its dependencies; keeping them is what
 *   keeps the cycle alive;
 * - dependencies are then re-created through the ordinary oracle between every
 *   other segment and each of the two halves, plus the two critical
 *   `segment -> blocker -> partner` ordering constraints.
 *
 * Selection prefers a non-hyperedge segment, then the shorter segment, then the
 * stable key. Splits are bounded per boundary and never retried once they
 * succeed.
 */

export const DEFAULT_SPLIT_POLICY = Object.freeze({
  bridgeClearance: MINIMUM_FOREIGN_WIRE_SEPARATION * 2,
  maximumSplitsPerBoundary: 64
});

export function SplitCriticalCycles(segments = [], dependencies = [], thresholds, options = {}) {
  const policy = { ...DEFAULT_SPLIT_POLICY, ...options };
  let working = segments.map((segment) => ({ ...segment }));
  let workingDependencies = dependencies.map((dependency) => ({ ...dependency }));
  const diagnostics = [];
  let splitCount = 0;

  // One round, matching ELK: every detected critical cycle contributes one
  // victim, victims are split shortest first, and the phase then ends. There is
  // no retry loop; whatever remains is reported as a diagnostic.
  const cycles = FindCyclicComponents(workingDependencies)
    .filter((cycle) => cycle.critical)
    .sort((left, right) => CompareText(left.members[0], right.members[0]));
  const chosen = new Set();
  const victims = [];
  for (const cycle of cycles) {
    const inside = new Set(cycle.members);
    const critical = workingDependencies.filter((dependency) => dependency.critical &&
      inside.has(dependency.sourceSegmentKey) && inside.has(dependency.targetSegmentKey));
    if (critical.length === 0) continue;
    const byKey = new Map(working.map((segment) => [segment.segmentKey, segment]));
    const dependency = [...critical].sort((left, right) =>
      CompareText(left.sourceSegmentKey, right.sourceSegmentKey) ||
      CompareText(left.targetSegmentKey, right.targetSegmentKey))[0];
    const source = byKey.get(dependency.sourceSegmentKey);
    const target = byKey.get(dependency.targetSegmentKey);
    if (!source || !target) continue;
    const victim = source.representsHyperedge && !target.representsHyperedge ? target : source;
    if (chosen.has(victim.segmentKey)) continue;
    chosen.add(victim.segmentKey);
    victims.push(victim.segmentKey);
  }

  for (const victimKey of victims.sort((left, right) => {
    const byKey = new Map(working.map((segment) => [segment.segmentKey, segment]));
    const first = byKey.get(left);
    const second = byKey.get(right);
    return (first.maximumY - first.minimumY) - (second.maximumY - second.minimumY) || CompareText(left, right);
  })) {
    if (splitCount >= policy.maximumSplitsPerBoundary) break;
    const byKey = new Map(working.map((segment) => [segment.segmentKey, segment]));
    const victim = byKey.get(victimKey);
    if (!victim) continue;
    const blockerKey = workingDependencies
      .filter((dependency) => dependency.critical &&
        (dependency.sourceSegmentKey === victimKey || dependency.targetSegmentKey === victimKey))
      .map((dependency) => dependency.sourceSegmentKey === victimKey
        ? dependency.targetSegmentKey
        : dependency.sourceSegmentKey)
      .filter((key) => byKey.has(key))
      .sort(CompareText)[0];
    const blocker = blockerKey ? byKey.get(blockerKey) : null;
    if (!blocker) continue;
    const bridgeY = ChooseFreeBridgeY(working, victim, thresholds, policy);
    if (bridgeY === null) {
      diagnostics.push(Object.freeze({
        code: "native-router-no-free-interval",
        segmentKey: victim.segmentKey
      }));
      continue;
    }
    const result = ApplySplit({ working, workingDependencies, victim, blocker, bridgeY, thresholds });
    working = result.segments;
    workingDependencies = result.dependencies;
    splitCount += 1;
  }

  const remaining = FindCyclicComponents(workingDependencies).filter((cycle) => cycle.critical);
  for (const cycle of remaining) {
    diagnostics.push(Object.freeze({
      code: "native-router-critical-cycle-unsplit",
      members: Object.freeze(cycle.members.slice(0, 16)),
      memberCount: cycle.members.length
    }));
  }

  const byKey = new Map(working.map((segment) => [segment.segmentKey, segment]));
  const survivors = workingDependencies.filter((dependency) =>
    byKey.has(dependency.sourceSegmentKey) && byKey.has(dependency.targetSegmentKey));

  return Object.freeze({
    segments: Object.freeze(working.map((segment) => Object.freeze(segment))),
    dependencies: Object.freeze(Deduplicate(survivors)),
    splitCount,
    diagnostics: Object.freeze(diagnostics)
  });
}

function ApplySplit({ working, workingDependencies, victim, blocker, bridgeY, thresholds }) {
  const depth = (victim.splitDepth ?? 0) + 1;
  const leftKey = `${victim.segmentKey}~split~${depth}~left`;
  const rightKey = `${victim.segmentKey}~split~${depth}~right`;
  const left = Object.freeze({
    ...victim,
    segmentKey: leftKey,
    outgoingY: Object.freeze([bridgeY]),
    minimumY: Math.min(...victim.incomingY, bridgeY),
    maximumY: Math.max(...victim.incomingY, bridgeY),
    straight: false,
    splitPartnerKey: rightKey,
    splitDepth: depth,
    bridgeY
  });
  const right = Object.freeze({
    ...victim,
    segmentKey: rightKey,
    incomingY: Object.freeze([bridgeY]),
    minimumY: Math.min(...victim.outgoingY, bridgeY),
    maximumY: Math.max(...victim.outgoingY, bridgeY),
    straight: false,
    splitPartnerKey: leftKey,
    splitDepth: depth,
    bridgeY
  });
  const segments = working.flatMap((segment) =>
    segment.segmentKey === victim.segmentKey ? [left, right] : [segment]);

  // The split segment loses every dependency it had; only the two critical
  // ordering constraints survive, and the rest are re-derived by the oracle.
  const dependencies = workingDependencies.filter((dependency) =>
    dependency.sourceSegmentKey !== victim.segmentKey &&
    dependency.targetSegmentKey !== victim.segmentKey);
  dependencies.push(MakeCritical(leftKey, blocker.segmentKey));
  dependencies.push(MakeCritical(blocker.segmentKey, rightKey));
  for (const other of segments) {
    if (other.segmentKey === left.segmentKey || other.segmentKey === right.segmentKey) continue;
    if (other.segmentKey === blocker.segmentKey) continue;
    dependencies.push(...CreateDependencyIfNecessary(other, left, thresholds).dependencies);
    dependencies.push(...CreateDependencyIfNecessary(other, right, thresholds).dependencies);
  }
  return { segments, dependencies };
}

export function ChooseFreeBridgeY(segments, victim, thresholds, policy = DEFAULT_SPLIT_POLICY) {
  const clearance = Math.max(
    MINIMUM_FOREIGN_WIRE_SEPARATION,
    Number(policy.bridgeClearance) || DEFAULT_SPLIT_POLICY.bridgeClearance
  );
  const occupied = [];
  for (const segment of segments) {
    if (segment.segmentKey === victim.segmentKey) continue;
    for (const values of [segment.incomingY, segment.outgoingY]) {
      for (const y of values) occupied.push(y);
    }
  }
  if (occupied.length === 0) return victim.minimumY - clearance;
  occupied.sort((left, right) => left - right);
  const centre = (Math.min(...occupied) + Math.max(...occupied)) / 2;
  const candidates = [];
  for (let index = 1; index < occupied.length; index += 1) {
    const gap = occupied[index] - occupied[index - 1];
    if (gap < 2 * Math.max(thresholds.criticalConflictThreshold, clearance)) continue;
    candidates.push(occupied[index - 1] + gap / 2);
  }
  candidates.push(occupied[0] - clearance);
  candidates.push(occupied[occupied.length - 1] + clearance);
  let best = null;
  let bestScore = null;
  for (const y of candidates.sort((left, right) => left - right)) {
    const critical = occupied.filter((value) =>
      Math.abs(value - y) < Math.max(thresholds.criticalConflictThreshold, clearance)).length;
    const crossings = segments.filter((segment) =>
      segment.segmentKey !== victim.segmentKey && y > segment.minimumY && y < segment.maximumY).length;
    const score = [critical, crossings, Math.abs(y - centre), y];
    if (!bestScore || CompareScore(score, bestScore) < 0) {
      best = y;
      bestScore = score;
    }
  }
  return best;
}

function CompareScore(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function MakeCritical(sourceSegmentKey, targetSegmentKey) {
  return Object.freeze({
    sourceSegmentKey,
    targetSegmentKey,
    critical: true,
    weight: 0,
    reason: "split-order",
    conflicts: 1,
    hard: true
  });
}

function CompareText(left, right) {
  return String(left ?? "").localeCompare(String(right ?? ""));
}
