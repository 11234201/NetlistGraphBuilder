import { compareIds, PhaseError } from './protocol.js';

// Ordered weighted groups: a violated successor relation merges its two groups,
// preserving required predecessor/successor order and recomputing the barycenter.
export function resolveOrderConstraints(ids, states, constraints) {
  const members = new Set(ids);
  const local = constraints.filter(({ before, after }) => members.has(before) && members.has(after));
  if (!local.length) return ids;
  const outgoing = new Map(ids.map((id) => [id, []])), incoming = new Map(ids.map((id) => [id, 0]));
  for (const { before, after } of local) {
    outgoing.get(before).push(after); incoming.set(after, incoming.get(after) + 1);
  }
  const ready = ids.filter((id) => incoming.get(id) === 0); let visited = 0;
  for (let i = 0; i < ready.length; i++) {
    visited++;
    for (const target of outgoing.get(ready[i])) {
      incoming.set(target, incoming.get(target) - 1);
      if (incoming.get(target) === 0) ready.push(target);
    }
  }
  if (visited !== ids.length) throw new PhaseError('p3', 'cyclic-order-constraint');
  let groups = ids.map((id) => ({ ids: [id], degree: states.get(id).degree || 1,
    sum: states.get(id).degree ? states.get(id).sum : states.get(id).value }));
  const owner = new Map(groups.map((group) => [group.ids[0], group]));
  while (true) {
    const positions = new Map(groups.map((group, position) => [group, position]));
    const successors = new Map(groups.map((group) => [group, new Set()]));
    const predecessors = new Map(groups.map((group) => [group, new Set()]));
    for (const { before, after } of local) {
      const source = owner.get(before), target = owner.get(after);
      if (source !== target) { successors.get(source).add(target); predecessors.get(target).add(source); }
    }
    const queue = groups.filter((group) => predecessors.get(group).size === 0), processed = new Set();
    let violation = null;
    for (let i = 0; i < queue.length && !violation; i++) {
      const group = queue[i]; processed.add(group);
      const predecessor = [...predecessors.get(group)].find((candidate) => positions.get(candidate) > positions.get(group));
      if (predecessor) violation = { before: predecessor.ids[0], after: group.ids[0] };
      for (const target of successors.get(group)) {
        if ([...predecessors.get(target)].every((candidate) => processed.has(candidate))) queue.push(target);
      }
    }
    if (!violation && processed.size !== groups.length) throw new PhaseError('p3', 'cyclic-group-constraint');
    if (!violation) break;
    const first = owner.get(violation.before), second = owner.get(violation.after);
    const merged = { ids: [...first.ids, ...second.ids], degree: first.degree + second.degree,
      sum: first.sum + second.sum };
    groups = groups.filter((group) => group !== first && group !== second);
    groups.push(merged);
    groups.sort((a, b) => a.sum / a.degree - b.sum / b.degree || compareIds(a.ids[0], b.ids[0]));
    for (const id of merged.ids) owner.set(id, merged);
  }
  const result = groups.flatMap((group) => group.ids), positions = new Map(result.map((id, i) => [id, i]));
  // A relation inside a merged group must remain consistent as well.
  if (local.some(({ before, after }) => positions.get(before) >= positions.get(after))) {
    throw new PhaseError('p3', 'inconsistent-merged-order');
  }
  return result;
}
