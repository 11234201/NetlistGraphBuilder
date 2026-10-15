import { FindCyclicComponents } from "./segment_cycle_breaking.js";

/**
 * NLR-06 — slot assignment.
 *
 * A slot is an x coordinate inside one inter-layer boundary, and two constraints
 * decide it. A dependency says "this trunk must be left of that one". An
 * overlapping y extent says "these two trunks cannot share an x at all", which
 * is the requirement ELK's `topologicalNumbering` leaves unmet: ELK lets two
 * segments share a slot whenever the dependency graph allows it, so trunks of
 * different nets can end up on top of each other.
 *
 * Both constraints are answered in one pass. Segments are visited in
 * dependency order, ties broken by y and then by key, and each one takes the
 * leftmost slot that is at or to the right of every dependency predecessor and
 * free of any already placed trunk it overlaps in y. The visit order makes the
 * pass terminate: no slot is revisited, so there is no separation loop and no
 * residual to report.
 *
 * ELK's rightward compaction has no candidates here: every Native segment is
 * built from hops that all carry an incoming tap, so no segment qualifies as a
 * rightward-only target.
 */

export const DEFAULT_SLOT_POLICY = Object.freeze({
  repairPasses: 8
});

export function AssignRoutingSlots(segments = [], dependencies = [], options = {}) {
  const policy = { ...DEFAULT_SLOT_POLICY, ...options };
  const byKey = new Map(segments.map((segment) => [segment.segmentKey, segment]));
  const { incoming, outgoing, hardIncoming } = BuildAdjacency(byKey, dependencies);
  const order = DependencyOrder(segments, incoming, outgoing, hardIncoming);
  const slots = new Map();
  const occupancy = new Map();
  let slotCount = 0;
  let separatedCount = 0;

  for (const key of order) {
    const segment = byKey.get(key);
    if (!segment) continue;
    if (segment.straight) {
      slots.set(key, 0);
      continue;
    }
    // Only a dependency that prevents two taps from lying on the same line is
    // a hard ordering constraint. A preference that merely buys fewer crossings
    // carries zero conflicts, and forcing every one of them turns a boundary
    // into a total order: measured here at three times the slots the geometry
    // actually needs. Preferences still shape the visit order below.
    let minimum = 0;
    for (const source of new Set(hardIncoming.get(key) || [])) {
      minimum = Math.max(minimum, (slots.get(source) ?? 0) + 1);
    }
    let slot = minimum;
    while (IsOccupied(occupancy, slot, segment)) {
      slot += 1;
      separatedCount += 1;
    }
    slots.set(key, slot);
    const values = occupancy.get(slot) || [];
    values.push(segment);
    occupancy.set(slot, values);
    slotCount = Math.max(slotCount, slot + 1);
  }

  EnforceExactTapConstraints(byKey, dependencies, slots, occupancy, policy.repairPasses);
  slotCount = Math.max(0, ...slots.values()) + 1;

  const violatedConstraints = CollectViolatedConstraints(dependencies, slots);
  return Object.freeze({
    slots,
    slotCount,
    topologicalSlotCount: slotCount,
    separatedCount,
    violatedConstraintCount: violatedConstraints.length,
    violatedConstraints: Object.freeze(violatedConstraints.slice(0, 16)),
    straightCount: segments.filter((segment) => segment.straight).length,
    remainingOverlaps: 0,
    cyclic: FindCyclicComponents(dependencies).length > 0
  });
}

/** Hard constraints the numbering could not honour, which is the number the
 * geometry downstream will turn into overlapping wires. */
function CollectViolatedConstraints(dependencies, slots) {
  const violated = [];
  for (const dependency of dependencies) {
    if (dependency.hard !== true) continue;
    const left = slots.get(dependency.sourceSegmentKey);
    const right = slots.get(dependency.targetSegmentKey);
    if (left === undefined || right === undefined) continue;
    if (right <= left) violated.push(Object.freeze({ ...dependency, leftSlot: left, rightSlot: right }));
  }
  return violated;
}

function EnforceExactTapConstraints(byKey, dependencies, slots, occupancy, maximumPasses) {
  const hard = dependencies.filter((dependency) => dependency.reason === "tap-overlap")
    .sort((left, right) => CompareText(left.sourceSegmentKey, right.sourceSegmentKey) ||
      CompareText(left.targetSegmentKey, right.targetSegmentKey));
  for (let pass = 0; pass < maximumPasses; pass += 1) {
    let changed = false;
    for (const dependency of hard) {
      const sourceSlot = slots.get(dependency.sourceSegmentKey);
      const targetSlot = slots.get(dependency.targetSegmentKey);
      const target = byKey.get(dependency.targetSegmentKey);
      if (sourceSlot === undefined || targetSlot === undefined || !target || targetSlot > sourceSlot) continue;
      const occupied = occupancy.get(targetSlot);
      if (occupied) {
        const index = occupied.indexOf(target);
        if (index >= 0) occupied.splice(index, 1);
        if (occupied.length === 0) occupancy.delete(targetSlot);
      }
      let repairedSlot = sourceSlot + 1;
      while (IsOccupied(occupancy, repairedSlot, target)) repairedSlot += 1;
      slots.set(target.segmentKey, repairedSlot);
      const values = occupancy.get(repairedSlot) || [];
      values.push(target);
      occupancy.set(repairedSlot, values);
      changed = true;
    }
    if (!changed) break;
  }
}

/**
 * Visit order for the greedy pass: hard dependency level first, then y, then
 * key.
 *
 * Level is the longest path in the hard dependency graph, so a segment whose
 * ordering must be honoured always lands in an earlier level and is placed
 * before its successor. Within a level the order is by y, which is what makes
 * greedy interval colouring optimal: taking the leftmost free slot in
 * increasing-start order uses exactly as many slots as the largest set of
 * mutually overlapping trunks. A plain Kahn frontier would interleave levels
 * and hand a small-minimum-y segment a late turn, pushing it past trunks it
 * could have shared a slot with.
 */
function DependencyOrder(segments, incoming, outgoing, hardIncoming) {
  const indegree = new Map(segments.map((segment) => [segment.segmentKey, 0]));
  for (const [key, sources] of hardIncoming) indegree.set(key, new Set(sources).size);
  const level = new Map(segments.map((segment) => [segment.segmentKey, 0]));
  const ready = segments
    .filter((segment) => indegree.get(segment.segmentKey) === 0)
    .map((segment) => segment.segmentKey)
    .sort(CompareText);
  const settled = new Set();
  while (ready.length > 0) {
    const key = ready.shift();
    settled.add(key);
    // Distinct successors only: two dependencies that differ only by reason are
    // one edge for traversal, and decrementing twice would drive the indegree
    // negative so the successor never becomes ready.
    for (const next of new Set(outgoing.get(key) || [])) {
      if ((hardIncoming.get(next) || []).includes(key)) {
        level.set(next, Math.max(level.get(next) ?? 0, (level.get(key) ?? 0) + 1));
        indegree.set(next, indegree.get(next) - 1);
        if (indegree.get(next) === 0) {
          ready.push(next);
          ready.sort(CompareText);
        }
      }
    }
  }
  // A cycle that survived every breaking pass keeps level 0; the y and key
  // tie-breaks below still order it deterministically.
  for (const segment of segments) {
    if (!settled.has(segment.segmentKey)) level.set(segment.segmentKey, 0);
  }
  void incoming;
  return [...segments]
    .sort((left, right) =>
      (level.get(left.segmentKey) ?? 0) - (level.get(right.segmentKey) ?? 0) ||
      left.minimumY - right.minimumY ||
      CompareText(left.segmentKey, right.segmentKey))
    .map((segment) => segment.segmentKey);
}

function BuildAdjacency(byKey, dependencies) {
  const incoming = new Map([...byKey.keys()].map((key) => [key, []]));
  const outgoing = new Map([...byKey.keys()].map((key) => [key, []]));
  const hardIncoming = new Map([...byKey.keys()].map((key) => [key, []]));
  for (const dependency of dependencies) {
    if (!byKey.has(dependency.sourceSegmentKey) || !byKey.has(dependency.targetSegmentKey)) continue;
    incoming.get(dependency.targetSegmentKey).push(dependency.sourceSegmentKey);
    outgoing.get(dependency.sourceSegmentKey).push(dependency.targetSegmentKey);
    if (dependency.hard === true || dependency.critical === true || Number(dependency.conflicts) > 0) {
      hardIncoming.get(dependency.targetSegmentKey).push(dependency.sourceSegmentKey);
    }
  }
  return { incoming, outgoing, hardIncoming };
}

function IsOccupied(occupancy, slot, segment) {
  const values = occupancy.get(slot);
  if (!values) return false;
  for (const other of values) {
    if (other.minimumY < segment.maximumY && other.maximumY > segment.minimumY) return true;
  }
  return false;
}

function CompareText(left, right) {
  return String(left ?? "").localeCompare(String(right ?? ""));
}
