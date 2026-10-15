export function AnalyzeAndPackStructure(model, orientation, placement, options = {}) {
  const componentGap = PositiveNumber(options.componentGap, 96);
  const channelReserve = Math.max(0, Number(options.channelReserve) || 0);
  const adjacency = BuildUndirected(model.nodes, orientation.edges);
  const componentByNode = FindComponents(model.nodes, adjacency);
  const membership = BuildFocusedMembership(model, orientation);
  const nodes = placement.nodes.map((node) => ({ ...node }));
  const orientedEdgeByKey = new Map(orientation.edges.map((edge) => [edge.key, edge]));
  const byComponent = new Map();
  for (const node of nodes) {
    const edge = node.dummy ? orientedEdgeByKey.get(node.logicalEdgeKey) : null;
    const id = componentByNode.get(node.key) ?? componentByNode.get(edge?.sourceKey) ?? node.key;
    const values = byComponent.get(id) || [];
    values.push(node);
    byComponent.set(id, values);
  }
  let cursorY = Number(options.margin) || 40;
  for (const componentId of [...byComponent.keys()].sort(CompareText)) {
    const values = byComponent.get(componentId);
    const top = Math.min(...values.map((node) => node.y));
    const bottom = Math.max(...values.map((node) => node.y + node.height));
    const shift = cursorY - top;
    for (const node of values) node.y += shift;
    cursorY += bottom - top + componentGap + channelReserve;
  }
  return Object.freeze({
    nodes: Object.freeze(nodes.map((node) => Object.freeze(node))),
    componentByNode,
    membership,
    componentCount: byComponent.size
  });
}

export function OrderStructureBlocks(model, orientation, proper, crossing) {
  const membership = BuildFocusedMembership(model, orientation);
  const edgeByKey = new Map(orientation.edges.map((edge) => [edge.key, edge]));
  const nodeByKey = new Map(proper.nodes.map((node) => [node.key, node]));
  const ownerOrder = [...new Set([...membership.values()].flatMap((entry) => entry.owners))].sort(CompareText);
  const ownerIndex = new Map(ownerOrder.map((owner, index) => [owner, index]));
  const layers = crossing.layers.map((layer) => {
    const priorOrder = new Map(layer.nodeKeys.map((key, index) => [key, index]));
    return Object.freeze({
    rank: layer.rank,
    nodeKeys: Object.freeze([...layer.nodeKeys].sort((left, right) => {
      const leftMembership = MembershipForNode(left, nodeByKey, edgeByKey, membership);
      const rightMembership = MembershipForNode(right, nodeByKey, edgeByKey, membership);
      return MembershipOrder(leftMembership, ownerIndex) - MembershipOrder(rightMembership, ownerIndex) ||
        CompareText(MembershipKey(leftMembership), MembershipKey(rightMembership)) ||
        priorOrder.get(left) - priorOrder.get(right);
    }))
  });
  });
  // Placement needs the group of each node, not only the layer order: two
  // adjacent nodes of different subtrees must be separated further than two
  // nodes inside one subtree, otherwise the trees read as one flat level.
  const nestedGroupByNode = BuildNestedSubtreeGroups(model, proper, membership);
  const groupByNode = new Map();
  for (const node of proper.nodes) {
    const membershipKey = MembershipKey(MembershipForNode(
      node.key, nodeByKey, edgeByKey, membership));
    groupByNode.set(node.key, nestedGroupByNode.get(node.key) || membershipKey);
  }
  return Object.freeze({ ...crossing, layers: Object.freeze(layers), membership, groupByNode });
}

/**
 * Refine a Focused branch into recursive exclusive-subtree groups. A real node
 * on the fanin side belongs to its nearest downstream real parent; proper-layer
 * dummies transparently forward that ownership. The fanout side is symmetric.
 * Shared membership stays one explicit bridge instead of being assigned to an
 * arbitrary subtree.
 */
function BuildNestedSubtreeGroups(model, proper, membership) {
  const roots = model.nodes.filter((node) => node.isFocusedRoot === true);
  if (roots.length !== 1) return new Map();
  const nodeByKey = new Map(proper.nodes.map((node) => [node.key, node]));
  const root = nodeByKey.get(roots[0].key);
  if (!root) return new Map();
  const outgoing = new Map(proper.nodes.map((node) => [node.key, []]));
  const incoming = new Map(proper.nodes.map((node) => [node.key, []]));
  for (const segment of proper.segments) {
    outgoing.get(segment.sourceKey)?.push(segment.targetKey);
    incoming.get(segment.targetKey)?.push(segment.sourceKey);
  }
  for (const values of outgoing.values()) values.sort(CompareText);
  for (const values of incoming.values()) values.sort(CompareText);
  const downstreamMemo = new Map();
  const upstreamMemo = new Map();
  const result = new Map();
  for (const node of proper.nodes) {
    const directMembership = membership.get(node.key);
    if (directMembership?.kind === "shared") continue;
    const inheritedMembership = directMembership?.owners?.length
      ? directMembership
      : InheritDummyMembership(node, outgoing, incoming, nodeByKey, membership,
        downstreamMemo, upstreamMemo);
    const membershipKey = MembershipKey(inheritedMembership);
    if (membershipKey === "~") continue;
    const neighborKeys = node.rank < root.rank
      ? FindNearestRealNeighbors(node.key, outgoing, nodeByKey, downstreamMemo)
      : node.rank > root.rank
        ? FindNearestRealNeighbors(node.key, incoming, nodeByKey, upstreamMemo)
        : [];
    if (neighborKeys.length === 0) continue;
    result.set(node.key, `${membershipKey}\u001e${neighborKeys.join("\u0000")}`);
  }
  return result;
}

function FindNearestRealNeighbors(key, adjacency, nodeByKey, memo, active = new Set()) {
  if (memo.has(key)) return memo.get(key);
  if (active.has(key)) return Object.freeze([]);
  active.add(key);
  const neighbors = new Set();
  for (const neighborKey of adjacency.get(key) || []) {
    const neighbor = nodeByKey.get(neighborKey);
    if (!neighbor) continue;
    if (!neighbor.dummy) {
      neighbors.add(neighborKey);
      continue;
    }
    for (const realKey of FindNearestRealNeighbors(
      neighborKey, adjacency, nodeByKey, memo, active)) neighbors.add(realKey);
  }
  active.delete(key);
  const result = Object.freeze([...neighbors].sort(CompareText));
  memo.set(key, result);
  return result;
}

function InheritDummyMembership(node, outgoing, incoming, nodeByKey, membership,
  downstreamMemo, upstreamMemo) {
  if (!node.dummy) return null;
  const owners = new Set();
  const realKeys = new Set([
    ...FindNearestRealNeighbors(node.key, outgoing, nodeByKey, downstreamMemo),
    ...FindNearestRealNeighbors(node.key, incoming, nodeByKey, upstreamMemo)
  ]);
  for (const realKey of realKeys) {
    for (const owner of membership.get(realKey)?.owners || []) owners.add(owner);
  }
  const values = [...owners].sort(CompareText);
  return { owners: values, kind: values.length > 1 ? "shared" : values.length === 1 ? "exclusive" : "unowned" };
}

function BuildFocusedMembership(model, orientation) {
  const focusedRoots = model.nodes.filter((node) => node.isFocusedRoot === true);
  const outgoing = new Map(model.nodes.map((node) => [node.key, []]));
  const incoming = new Map(model.nodes.map((node) => [node.key, []]));
  for (const edge of orientation.edges) {
    if (edge.ignoredForLayering) continue;
    outgoing.get(edge.layoutSourceKey).push(edge.layoutTargetKey);
    incoming.get(edge.layoutTargetKey).push(edge.layoutSourceKey);
  }
  for (const values of outgoing.values()) values.sort(CompareText);
  for (const values of incoming.values()) values.sort(CompareText);
  const ownersByNode = new Map(model.nodes.map((node) => [node.key, new Set()]));
  for (const root of focusedRoots) {
    const branches = [
      ...(incoming.get(root.key) || []).map((owner) => ({ owner, adjacency: incoming })),
      ...(outgoing.get(root.key) || []).map((owner) => ({ owner, adjacency: outgoing }))
    ].sort((left, right) => CompareText(left.owner, right.owner));
    for (const { owner, adjacency } of branches) {
      const stack = [owner];
      while (stack.length > 0) {
        const key = stack.pop();
        if (key === root.key) continue;
        if (ownersByNode.get(key).has(owner)) continue;
        ownersByNode.get(key).add(owner);
        for (const next of adjacency.get(key) || []) stack.push(next);
      }
    }
  }
  return Object.freeze(new Map([...ownersByNode].map(([key, owners]) => [key, Object.freeze({
    owners: Object.freeze([...owners].sort(CompareText)),
    kind: owners.size > 1 ? "shared" : owners.size === 1 ? "exclusive" : "unowned"
  })])));
}

function MembershipForNode(key, nodeByKey, edgeByKey, membership) {
  const direct = membership.get(key);
  if (direct?.owners?.length) return direct;
  const node = nodeByKey.get(key);
  const edge = node?.dummy ? edgeByKey.get(node.logicalEdgeKey) : null;
  const source = membership.get(edge?.sourceKey);
  const target = membership.get(edge?.targetKey);
  const owners = [...new Set([...(source?.owners || []), ...(target?.owners || [])])].sort(CompareText);
  return { owners, kind: owners.length > 1 ? "shared" : owners.length === 1 ? "exclusive" : "unowned" };
}

function MembershipOrder(entry, ownerIndex) {
  if (!entry?.owners?.length) return Number.MAX_SAFE_INTEGER;
  const indexes = entry.owners.map((owner) => ownerIndex.get(owner) ?? ownerIndex.size);
  return indexes.reduce((sum, value) => sum + value, 0) / indexes.length;
}

function MembershipKey(entry) {
  return entry?.owners?.join("\u0000") || "~";
}

function BuildUndirected(nodes, edges) {
  const result = new Map(nodes.map((node) => [node.key, []]));
  for (const edge of edges) {
    result.get(edge.sourceKey)?.push(edge.targetKey);
    result.get(edge.targetKey)?.push(edge.sourceKey);
  }
  for (const values of result.values()) values.sort(CompareText);
  return result;
}

function FindComponents(nodes, adjacency) {
  const result = new Map();
  for (const node of nodes) {
    if (result.has(node.key)) continue;
    const componentId = node.key;
    result.set(node.key, componentId);
    const stack = [node.key];
    while (stack.length > 0) {
      const key = stack.pop();
      for (const neighbor of adjacency.get(key) || []) {
        if (result.has(neighbor)) continue;
        result.set(neighbor, componentId);
        stack.push(neighbor);
      }
    }
  }
  return result;
}

function PositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function CompareText(left, right) {
  return String(left).localeCompare(String(right));
}
