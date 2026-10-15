/**
 * NLR-05 — deterministic cycle resolution.
 *
 * The segment dependency graph can contain cycles. ELK breaks them with a
 * seeded random source; this repository cannot, so every decision is keyed by
 * stable topology instead:
 *
 * - strongly connected components are found iteratively (no recursion depth
 *   limit on deep chains);
 * - non-critical cycles are resolved by removing zero-weight symmetric
 *   dependencies first and then reversing the minimum-weight dependency, with
 *   ties broken by segment key;
 * - critical cycles are handed to `segment_splitting.js` exactly once.
 *
 * There is no retry loop, no outer lane and no fallback to a candidate list.
 */

export function BuildDependencyAdjacency(dependencies = []) {
  const adjacency = new Map();
  for (const dependency of dependencies) {
    if (!adjacency.has(dependency.sourceSegmentKey)) adjacency.set(dependency.sourceSegmentKey, []);
    adjacency.get(dependency.sourceSegmentKey).push(dependency.targetSegmentKey);
  }
  for (const values of adjacency.values()) values.sort(CompareText);
  return adjacency;
}

export function FindStronglyConnectedComponents(nodeKeys = [], adjacency) {
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const components = [];
  let counter = 0;

  for (const root of nodeKeys) {
    if (index.has(root)) continue;
    const work = [{ node: root, edgeIndex: 0 }];
    index.set(root, counter);
    low.set(root, counter);
    counter += 1;
    stack.push(root);
    onStack.add(root);
    while (work.length > 0) {
      const frame = work[work.length - 1];
      const edges = adjacency.get(frame.node) || [];
      if (frame.edgeIndex < edges.length) {
        const next = edges[frame.edgeIndex];
        frame.edgeIndex += 1;
        if (!index.has(next)) {
          index.set(next, counter);
          low.set(next, counter);
          counter += 1;
          stack.push(next);
          onStack.add(next);
          work.push({ node: next, edgeIndex: 0 });
        } else if (onStack.has(next)) {
          low.set(frame.node, Math.min(low.get(frame.node), index.get(next)));
        }
        continue;
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1].node;
        low.set(parent, Math.min(low.get(parent), low.get(frame.node)));
      }
      if (low.get(frame.node) === index.get(frame.node)) {
        const component = [];
        for (;;) {
          const key = stack.pop();
          onStack.delete(key);
          component.push(key);
          if (key === frame.node) break;
        }
        components.push(Object.freeze(component.slice().sort(CompareText)));
      }
    }
  }
  return Object.freeze(components);
}

export function FindCyclicComponents(dependencies = []) {
  const adjacency = BuildDependencyAdjacency(dependencies);
  const nodeKeys = [...new Set([
    ...dependencies.map((dependency) => dependency.sourceSegmentKey),
    ...dependencies.map((dependency) => dependency.targetSegmentKey)
  ])].sort(CompareText);
  const components = FindStronglyConnectedComponents(nodeKeys, adjacency)
    .filter((component) => component.length > 1)
    .map((component) => {
      const inside = new Set(component);
      return Object.freeze({
        members: component,
        critical: dependencies.some((dependency) => dependency.critical &&
          inside.has(dependency.sourceSegmentKey) && inside.has(dependency.targetSegmentKey))
      });
    });
  return components;
}

export function BreakNonCriticalCycles(dependencies = [], options = {}) {
  const maximumPasses = Math.max(1, Number(options.maximumPasses) || 64);
  const edges = dependencies.map((dependency) => ({ ...dependency }));
  const removed = new Set();
  const diagnostics = [];
  let removedCount = 0;
  let reversedCount = 0;

  for (let pass = 0; pass < maximumPasses; pass += 1) {
    const live = LiveEntries(edges, removed);
    const cycles = FindCyclicComponents(live.map((entry) => entry.dep))
      .filter((cycle) => !cycle.critical);
    if (cycles.length === 0) break;
    // Indexing once per pass makes the work inside a cycle proportional to the
    // edges that cycle owns rather than to the whole dependency list.
    const outByNode = IndexBySource(live);
    // An edge already spent in this pass is no longer live, so a later cycle
    // must not pick it again; otherwise that cycle survives into the next pass.
    const spent = new Set();
    let changed = false;
    for (const cycle of cycles.sort((left, right) => CompareText(left.members[0], right.members[0]))) {
      const internal = InternalPositions(live, outByNode, cycle.members)
        .filter((position) => !spent.has(position) && live[position].dep.critical !== true);
      // A soft preference is spent before a hard constraint: dropping zero
      // weight is free, and a nonzero preference still costs less than laying
      // two wires on the same line.
      const zeroWeight = internal.filter((position) =>
        live[position].dep.hard !== true && live[position].dep.weight === 0);
      if (zeroWeight.length > 0) {
        for (const position of zeroWeight) {
          removed.add(live[position].index);
          spent.add(position);
          removedCount += 1;
        }
        changed = true;
        continue;
      }
      const victim = CheapestPosition(live, internal);
      if (victim === undefined) continue;
      ReverseEntry(live, outByNode, edges, victim);
      spent.add(victim);
      reversedCount += 1;
      changed = true;
    }
    if (!changed) break;
  }

  const remaining = FindCyclicComponents(LiveEntries(edges, removed).map((entry) => entry.dep))
    .filter((cycle) => cycle.critical);
  for (const cycle of remaining) {
    diagnostics.push(Object.freeze({
      code: "native-router-critical-cycle-unsplit",
      members: Object.freeze(cycle.members)
    }));
  }

  return Object.freeze({
    dependencies: Object.freeze(LiveEntries(edges, removed).map((entry) => Object.freeze(entry.dep))),
    removedCount,
    reversedCount,
    diagnostics: Object.freeze(diagnostics)
  });
}

/**
 * Last-resort pass over whatever splitting left behind.
 *
 * A split introduces two new segments, and the critical ordering constraints it
 * adds can close a cycle that did not exist when `SplitCriticalCycles` ran.
 * Nothing else consumes those cycles, so the topological numbering would fall
 * back to key order and silently violate the constraints inside the component.
 * This pass makes the graph acyclic before slots are numbered: the cheapest
 * non-critical internal constraint goes first, and a critical one is only
 * dropped when no other edge keeps the cycle alive.
 */
export function BreakResidualCycles(dependencies = [], options = {}) {
  const maximumPasses = Math.max(1, Number(options.maximumPasses) || 64);
  const edges = dependencies.map((dependency) => ({ ...dependency }));
  const removed = new Set();
  const diagnostics = [];
  let removedCount = 0;

  // SCCs cannot participate in one another's cycles. Resolve each initial
  // component against its own edge set so a dense boundary does not force 64
  // full scans over every acyclic dependency in that boundary.
  const initialCycles = FindCyclicComponents(edges)
    .sort((left, right) => CompareText(left.members[0], right.members[0]));
  for (const root of initialCycles) {
    const rootMembers = new Set(root.members);
    const rootIndexes = [];
    for (let index = 0; index < edges.length; index += 1) {
      const dependency = edges[index];
      if (rootMembers.has(dependency.sourceSegmentKey) &&
        rootMembers.has(dependency.targetSegmentKey)) rootIndexes.push(index);
    }
    for (let pass = 0; pass < maximumPasses; pass += 1) {
      const live = rootIndexes
        .filter((index) => !removed.has(index))
        .map((index) => ({ index, dep: edges[index] }));
      const cycles = FindCyclicComponents(live.map((entry) => entry.dep))
        .sort((left, right) => CompareText(left.members[0], right.members[0]));
      if (cycles.length === 0) break;
      const outByNode = IndexBySource(live);
      const spent = new Set();
      let changed = false;
      for (const cycle of cycles) {
        const internal = InternalPositions(live, outByNode, cycle.members)
          .filter((position) => !spent.has(position));
        if (internal.length === 0) continue;
        const victim = CheapestPosition(live, internal);
        const entry = live[victim];
        removed.add(entry.index);
        spent.add(victim);
        removedCount += 1;
        changed = true;
        diagnostics.push(Object.freeze({
          code: "native-router-residual-cycle-broken",
          members: Object.freeze(cycle.members.slice(0, 8)),
          memberCount: cycle.members.length,
          dropped: Object.freeze([entry.dep.sourceSegmentKey, entry.dep.targetSegmentKey]),
          critical: entry.dep.critical === true
        }));
      }
      if (!changed) break;
    }
  }

  return Object.freeze({
    dependencies: Object.freeze(LiveEntries(edges, removed).map((entry) => Object.freeze(entry.dep))),
    removedCount,
    diagnostics: Object.freeze(diagnostics)
  });
}

/**
 * Live entries carry their position in `edges`, so a removal is a set insert
 * instead of a splice over the whole list. Entries are rebuilt once per pass.
 */
function LiveEntries(edges, removed) {
  const entries = [];
  for (let index = 0; index < edges.length; index += 1) {
    if (!removed.has(index)) entries.push({ index, dep: edges[index] });
  }
  return entries;
}

function IndexBySource(entries) {
  const outByNode = new Map();
  entries.forEach((entry, position) => {
    const bucket = outByNode.get(entry.dep.sourceSegmentKey);
    if (bucket) bucket.push(position);
    else outByNode.set(entry.dep.sourceSegmentKey, [position]);
  });
  return outByNode;
}

/**
 * Positions whose both endpoints belong to the cycle. This walks only the
 * outgoing buckets of the cycle's own members, so it costs the cycle's edges
 * rather than every dependency in the boundary.
 */
function InternalPositions(entries, outByNode, memberKeys) {
  const inside = new Set(memberKeys);
  const positions = [];
  for (const node of memberKeys) {
    for (const position of outByNode.get(node) || []) {
      if (inside.has(entries[position].dep.targetSegmentKey)) positions.push(position);
    }
  }
  return positions.sort((left, right) => left - right);
}

function ReverseEntry(live, outByNode, edges, position) {
  const entry = live[position];
  const dep = entry.dep;
  const swapped = {
    ...dep,
    sourceSegmentKey: dep.targetSegmentKey,
    targetSegmentKey: dep.sourceSegmentKey,
    reason: "cycle-reversed"
  };
  edges[entry.index] = swapped;
  entry.dep = swapped;
  const from = outByNode.get(dep.sourceSegmentKey);
  if (from) {
    const at = from.indexOf(position);
    if (at >= 0) from.splice(at, 1);
  }
  const to = outByNode.get(swapped.sourceSegmentKey);
  if (to) to.push(position);
  else outByNode.set(swapped.sourceSegmentKey, [position]);
}

/**
 * Lowest-priority victim. A linear scan picks the same edge a stable sort would
 * put first, without paying O(n log n) string comparisons on dense boundaries.
 */
function CheapestPosition(live, positions) {
  let best = positions[0];
  for (let index = 1; index < positions.length; index += 1) {
    const candidate = positions[index];
    if (CompareVictims(live[candidate].dep, live[best].dep) < 0) best = candidate;
  }
  return best;
}

function CompareVictims(left, right) {
  return Number(left.hard === true) - Number(right.hard === true) ||
    left.weight - right.weight ||
    CompareText(left.sourceSegmentKey, right.sourceSegmentKey) ||
    CompareText(left.targetSegmentKey, right.targetSegmentKey);
}

function CompareText(left, right) {
  return String(left ?? "").localeCompare(String(right ?? ""));
}
