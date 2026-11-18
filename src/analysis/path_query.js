import { normalizeShowPath, pathError, SHOW_PATH_POLICY } from "../contracts/show_path.js";

// Both adapters expose pin-accurate vertices and real wires. Internal gate
// arcs have no wire ID. Exactly one vertex on a gate traversal carries cost.
export function createPathIndex(vertices, arcs, endpoints, cuts = []) {
  checkPathBudget(vertices.length + arcs.length + cuts.length + endpoints.size);
  const nodes = new Map(vertices.map((v) => [v.id, { ...v, incoming: [], outgoing: [] }]));
  for (const arc of arcs) {
    nodes.get(arc.source).outgoing.push(arc);
    nodes.get(arc.target).incoming.push(arc);
  }
  for (const cut of cuts) {
    (nodes.get(cut.source).uncertainOutputs ||= []).push(cut);
    (nodes.get(cut.target).uncertainInputs ||= []).push(cut);
  }
  const all = new Set(nodes.keys());
  const orderedIds = [...all].sort();
  let previousKey, previousResult;
  return { endpoints, query(value) {
    const query = normalizeShowPath(value);
    if (!query?.enabled) return null;
    const key = JSON.stringify(query);
    if (key === previousKey) return previousResult;
    const result = extract(query);
    previousKey = key; previousResult = result;
    return result;
  } };

  function extract(query) {
    const reasons = new Set();
    let expandedCount = 0;
    const work = { reachableNodes: 0, reachableArcs: 0, memberNodes: 0, memberArcs: 0 };
    function expand(keys, role) {
      return keys.flatMap((key) => {
        const entry = endpoints.get(key);
        if (!entry) throw pathError("stale-endpoint", "Source endpoint is unavailable: " + key);
        if (entry.issue) reasons.add(entry.issue);
        const ids = entry[role];
        expandedCount += ids.length;
        checkPathBudget(expandedCount);
        if (!ids.length) throw pathError("invalid-direction", entry.label + " has no known " +
          (role === "starts" ? "output" : "input") + " endpoint.");
        return ids.map((id) => ({ id, key, name: entry.label, copyName: entry.copyName }));
      });
    }
    const starts = expand(query.starts, "starts"), ends = expand(query.ends, "ends");
    const endPins = new Map(query.ends.map((key) => [key, new Set(endpoints.get(key).ends)]));
    for (const ref of starts) if (endPins.has(ref.key) && !endPins.get(ref.key).has(ref.id)) ends.push(ref);
    const downstream = starts.length ? reachable(nodes, starts.map((s) => s.id), true, work) : all;
    const targets = [...new Set(ends.map((ref) => ref.id))];
    const upstream = ends.length ? reachable(nodes, targets, false, work) : all;
    const members = new Set([...downstream].filter((id) => upstream.has(id)));
    work.memberNodes = members.size;
    // Unproven connections can qualify coverage, but never become path members.
    const possibleUpstream = cuts.length && ends.length ? reachable(nodes, targets, false, work, true) : upstream;
    for (const id of (starts.length ? downstream : upstream)) {
      const node = nodes.get(id);
      if (node.issue && possibleUpstream.has(id)) reasons.add(node.issue);
      if (starts.length) for (const cut of node.uncertainOutputs || []) {
        if (possibleUpstream.has(cut.target)) reasons.add(cut.issue);
      }
    }
    const order = topologicalOrder(nodes, members);
    if (order.length !== members.size) reasons.add("combinational-cycle");
    const automatic = (direction) => orderedIds.filter((id) => members.has(id) && !nodes.get(id)[direction].length)
      .map((id) => ({ id, name: nodes.get(id).label }));
    const actualStarts = starts.length ? starts : automatic("incoming");
    const actualEnds = ends.length ? ends : automatic("outgoing");
    const endIds = ends.length ? targets : actualEnds.map((ref) => ref.id);
    const endCone = ends.length ? upstream : reachable(nodes, endIds, false, work, false, members);
    const remaining = distancesToTargets(nodes, endIds, cuts, endCone, ends.length ? possibleUpstream : undefined);
    const distanceLabel = (ends.length ? "To selected end" : "To auto end") + ((query.ends.length || actualEnds.length) === 1 ? "" : "s");
    const relative = distances(nodes, order, members, actualStarts.map((s) => s.id));
    const displayNodes = new Set(), displayEdges = new Set();
    let unknownDistanceCount = 0;
    for (const id of members) {
      const node = nodes.get(id);
      if (node.displayId) {
        displayNodes.add(node.displayId);
        if (remaining.get(id) === null) unknownDistanceCount++;
      }
      for (const edge of node.outgoing) if (members.has(edge.target)) {
        work.memberArcs++;
        if (edge.wire) displayEdges.add(edge.wire);
      }
    }
    function row(ref, levels) {
      const node = nodes.get(ref.id);
      const level = levels.get(ref.id);
      return { ...ref, label: node.label, displayId: node.displayId, reachable: members.has(ref.id),
        boundary: node.boundary, distanceLabel, toTarget: remaining.get(ref.id) ?? null, distanceUnknown: remaining.get(ref.id) === null,
        partial: members.has(ref.id) && !level, min: level?.min ?? null, max: level?.max ?? null };
    }
    const limit = SHOW_PATH_POLICY.maximumReportedEndpoints;
    const rows = (refs) => refs.slice(0, limit).map((ref) => row(ref, relative));
    return { work, unknownDistanceCount, nodeIds: displayNodes, edgeIds: displayEdges, reasons: [...reasons].sort(),
      status: reasons.size ? "partial" : members.size ? "complete" : "no-path",
      starts: rows(actualStarts), ends: rows(actualEnds), startCount: actualStarts.length, endCount: actualEnds.length,
      endpointsTruncated: actualStarts.length > limit || actualEnds.length > limit,
      automaticStarts: !starts.length, automaticEnds: !ends.length,
      levels: new Map(orderedIds.filter((id) => members.has(id) && nodes.get(id).displayId).map((id) => [id, row({ id }, relative)])),
      // One source at a time, including automatically discovered sources.
      // Never materialize a sources-by-nodes distance matrix.
      fromStart(id) {
        if (!members.has(id)) return new Map();
        if (order.length === members.size) return distances(nodes, order, members, [id]);
        const cone = reachable(nodes, [id], true, undefined, false, members);
        const result = distances(nodes, topologicalOrder(nodes, cone), cone, [id]);
        for (const member of cone) if (!result.has(member)) result.set(member, null);
        return result;
      }
    };
  }
}

export function checkPathBudget(count) {
  if (count > SHOW_PATH_POLICY.maximumObjects) throw Object.assign(pathError("budget",
    `Show Path requires ${count} objects (limit ${SHOW_PATH_POLICY.maximumObjects}). Choose a smaller module.`),
    { pathContext: { objectCount: count, objectLimit: SHOW_PATH_POLICY.maximumObjects } });
}

function reachable(nodes, seeds, forward, work, includeCuts = false, members) {
  const seen = new Set(seeds), queue = [...seen];
  for (let i = 0; i < queue.length; i++) {
    const node = nodes.get(queue[i]);
    const arcs = forward ? node.outgoing : includeCuts && node.uncertainInputs
      ? node.incoming.concat(node.uncertainInputs) : node.incoming;
    if (work) { work.reachableNodes++; work.reachableArcs += arcs.length; }
    for (const edge of arcs) {
      const next = forward ? edge.target : edge.source;
      if (!seen.has(next) && (!members || members.has(next))) { seen.add(next); queue.push(next); }
    }
  }
  return seen;
}

// A selected end contributes a zero-length option. Continue through internal ends
// so the range also includes downstream selected ends.
function distancesToTargets(nodes, targets, cuts, cone, possibleCone) {
  const targetSet = new Set(targets), values = new Map();
  for (const id of topologicalOrder(nodes, cone, true)) {
    const isTarget = targetSet.has(id);
    let min = isTarget ? 0 : Infinity, max = isTarget ? 0 : -Infinity;
    for (const arc of nodes.get(id).outgoing) {
      const next = values.get(arc.target);
      if (!next) continue;
      const cost = nodes.get(arc.target).cost || 0;
      min = Math.min(min, cost + next.min);
      max = Math.max(max, cost + next.max);
    }
    values.set(id, { min, max });
  }
  // Cycles and uncertain connections matter only when they can reach a target.
  for (const id of cone) if (!values.has(id)) values.set(id, null);
  if (cuts.length) {
    const possible = possibleCone ?? reachable(nodes, targets, false, undefined, true);
    const uncertain = cuts.filter((arc) => possible.has(arc.target)).map((arc) => arc.source);
    for (const id of reachable(nodes, uncertain, false)) values.set(id, null);
  }
  return values;
}

function topologicalOrder(nodes, members, reverse = false) {
  const predecessors = reverse ? "outgoing" : "incoming", predecessor = reverse ? "target" : "source";
  const successors = reverse ? "incoming" : "outgoing", successor = reverse ? "source" : "target";
  const pending = new Map(), queue = [];
  for (const id of members) {
    let count = 0;
    for (const arc of nodes.get(id)[predecessors]) if (members.has(arc[predecessor])) count++;
    pending.set(id, count);
    if (!count) queue.push(id);
  }
  for (let i = 0; i < queue.length; i++) for (const arc of nodes.get(queue[i])[successors]) {
    const next = arc[successor];
    if (!members.has(next)) continue;
    const count = pending.get(next) - 1;
    pending.set(next, count);
    if (!count) queue.push(next);
  }
  return queue;
}

function distances(nodes, order, members, seeds) {
  const values = new Map();
  for (const id of seeds) if (members.has(id)) values.set(id, { min: 0, max: 0 });
  const result = new Map();
  for (const id of order) {
    const value = values.get(id);
    if (!value) continue;
    result.set(id, value);
    for (const arc of nodes.get(id).outgoing) {
      if (!members.has(arc.target)) continue;
      const cost = nodes.get(arc.target).cost || 0;
      const old = values.get(arc.target);
      values.set(arc.target, { min: Math.min(old?.min ?? Infinity, value.min + cost),
        max: Math.max(old?.max ?? -Infinity, value.max + cost) });
    }
  }
  return result;
}
