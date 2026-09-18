import { groupNodesByLevel, round } from "../nodePlacementShared.js";
import { compactOrderedLayer } from "./balancedPlacement.js";

const SHARED_SEPARATOR = "\u0000";

/**
 * Decompose the visible fanin cone of one focused cell into immediate-root
 * trees. A node is never copied: membership records every immediate branch
 * that can be reached from that node, so overlap remains explicit.
 */
export function buildFocusedFaninTreeBlocks(nodes, edges) {
  const nodeById = new Map((nodes || []).map((node) => [node.id, node]));
  const roots = [...nodeById.values()]
    .filter((node) => node.isFocusedRoot === true && node.kind === "cell")
    .sort(compareNodes);
  if (roots.length !== 1) return emptyDecomposition();
  const root = roots[0];
  const incoming = new Map();
  for (const edge of [...(edges || [])].sort(compareEdges)) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    const entries = incoming.get(edge.target) || [];
    entries.push(edge.source);
    incoming.set(edge.target, entries);
  }
  for (const entries of incoming.values()) entries.sort(compareIds);

  const branchRoots = [...new Set(incoming.get(root.id) || [])]
    .filter((id) => id !== root.id)
    .sort(compareIds);
  const membership = new Map();
  const queue = [];
  for (const branchId of branchRoots) {
    membership.set(branchId, new Set([branchId]));
    queue.push(branchId);
  }
  // The visible focused graph has bounded depth. A membership bit can enter a
  // node only once, so this work is O(branch-reachable edges), not a retry loop.
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const nodeId = queue[cursor];
    const owners = membership.get(nodeId);
    for (const parentId of incoming.get(nodeId) || []) {
      if (parentId === root.id) continue;
      const parentOwners = membership.get(parentId) || new Set();
      const before = parentOwners.size;
      for (const owner of owners) parentOwners.add(owner);
      membership.set(parentId, parentOwners);
      if (parentOwners.size !== before) queue.push(parentId);
    }
  }

  const entries = [...membership.entries()].map(([nodeId, owners]) => {
    const ownerIds = [...owners].sort(compareIds);
    return Object.freeze({
      nodeId,
      ownerIds: Object.freeze(ownerIds),
      membershipKey: ownerIds.join(SHARED_SEPARATOR),
      shared: ownerIds.length > 1
    });
  }).sort((left, right) => compareIds(left.nodeId, right.nodeId));
  return Object.freeze({
    rootId: root.id,
    branchRootIds: Object.freeze(branchRoots),
    entries: Object.freeze(entries),
    membershipByNodeId: new Map(entries.map((entry) => [entry.nodeId, entry]))
  });
}

export function summarizeFocusedFaninTreeBlocks(nodes, edges) {
  const decomposition = buildFocusedFaninTreeBlocks(nodes, edges);
  const hierarchy = buildFocusedFaninHierarchy(nodes, edges, decomposition);
  const nodeById = new Map((nodes || []).map((node) => [node.id, node]));
  const visualRanks = inferVisualRanks(decomposition.entries, nodeById);
  const groups = new Map();
  for (const entry of decomposition.entries) {
    const group = groups.get(entry.membershipKey) || [];
    group.push(entry.nodeId);
    groups.set(entry.membershipKey, group);
  }
  const levels = new Map();
  for (const entry of decomposition.entries) {
    const node = nodeById.get(entry.nodeId);
    if (!node) continue;
    const level = visualRanks.get(node.id);
    const layer = levels.get(level) || [];
    layer.push({ entry, node });
    levels.set(level, layer);
  }
  let intervalCount = 0;
  let fragmentedGroupCount = 0;
  let alternationCount = 0;
  const layerReports = [...levels].sort(([left], [right]) => left - right)
    .map(([level, layer]) => {
      layer.sort((left, right) => Number(left.node.y) - Number(right.node.y) ||
        compareIds(left.node.id, right.node.id));
      const intervals = new Map();
      let previousKey = null;
      for (const { entry } of layer) {
        if (entry.membershipKey !== previousKey) {
          intervals.set(entry.membershipKey, (intervals.get(entry.membershipKey) || 0) + 1);
          if (previousKey !== null) alternationCount += 1;
          previousKey = entry.membershipKey;
        }
      }
      const fragments = [...intervals.values()].filter((count) => count > 1).length;
      fragmentedGroupCount += fragments;
      intervalCount += [...intervals.values()].reduce((sum, count) => sum + count, 0);
      return Object.freeze({
        level,
        nodeCount: layer.length,
        groupCount: intervals.size,
        fragmentedGroupCount: fragments,
        intervalCount: [...intervals.values()].reduce((sum, count) => sum + count, 0)
      });
    });
  const parentChildErrors = [];
  let crossMembershipEdgeCount = 0;
  for (const edge of edges || []) {
    const source = decomposition.membershipByNodeId.get(edge.source);
    const target = decomposition.membershipByNodeId.get(edge.target);
    if (!source || !target) continue;
    if (source.membershipKey !== target.membershipKey) crossMembershipEdgeCount += 1;
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    if (sourceNode && targetNode) {
      parentChildErrors.push(Math.abs(centerY(sourceNode) - centerY(targetNode)));
    }
  }
  return Object.freeze({
    rootId: decomposition.rootId,
    branchRootIds: decomposition.branchRootIds,
    branchCount: decomposition.branchRootIds.length,
    assignedNodeCount: decomposition.entries.length,
    exclusiveNodeCount: decomposition.entries.filter((entry) => !entry.shared).length,
    sharedNodeCount: decomposition.entries.filter((entry) => entry.shared).length,
    membershipGroupCount: groups.size,
    fragmentedGroupCount,
    intervalCount,
    alternationCount,
    visualRankCount: levels.size,
    providerLevelsPresent: [...decomposition.entries].every(({ nodeId }) =>
      Number.isFinite(Number(nodeById.get(nodeId)?.level))),
    meanParentChildCenterError: round(mean(parentChildErrors)),
    crossMembershipEdgeCount,
    hierarchy,
    groups: Object.freeze([...groups].map(([membershipKey, nodeIds]) => Object.freeze({
      ownerIds: Object.freeze(membershipKey.split(SHARED_SEPARATOR)),
      nodeCount: nodeIds.length
    })).sort((left, right) => left.ownerIds.join(SHARED_SEPARATOR)
      .localeCompare(right.ownerIds.join(SHARED_SEPARATOR)))),
    levels: Object.freeze(layerReports)
  });
}

/** Build one deterministic arborescence inside every exclusive membership.
 * Reconvergent DAG nodes select their nearest downstream parent; shared nodes
 * remain outside the exclusive trees and are reported as explicit bridges. */
export function buildFocusedFaninHierarchy(nodes, edges, existingDecomposition = null) {
  const decomposition = existingDecomposition || buildFocusedFaninTreeBlocks(nodes, edges);
  const nodeById = new Map((nodes || []).map((node) => [node.id, node]));
  const outgoing = new Map();
  for (const edge of [...(edges || [])].sort(compareEdges)) {
    if (!decomposition.membershipByNodeId.has(edge.source) ||
        !decomposition.membershipByNodeId.has(edge.target)) continue;
    outgoing.set(edge.source, [...(outgoing.get(edge.source) || []), edge.target]);
  }
  const childrenByParent = new Map();
  for (const entry of decomposition.entries) {
    if (entry.shared || decomposition.branchRootIds.includes(entry.nodeId)) continue;
    const node = nodeById.get(entry.nodeId);
    const candidates = (outgoing.get(entry.nodeId) || [])
      .filter((targetId) => decomposition.membershipByNodeId.get(targetId)?.membershipKey ===
        entry.membershipKey)
      .map((targetId) => nodeById.get(targetId))
      .filter(Boolean)
      .sort((left, right) => {
        const leftDistance = Math.max(0, Number(left.level) - Number(node?.level));
        const rightDistance = Math.max(0, Number(right.level) - Number(node?.level));
        return leftDistance - rightDistance || compareIds(left.id, right.id);
      });
    const parent = candidates[0];
    if (!parent) continue;
    childrenByParent.set(parent.id, [...(childrenByParent.get(parent.id) || []), entry.nodeId]);
  }
  for (const children of childrenByParent.values()) {
    children.sort((leftId, rightId) => comparePlacedNodes(
      nodeById.get(leftId), nodeById.get(rightId)));
  }
  const branches = decomposition.branchRootIds.map((rootId) => {
    const visited = new Set();
    let leafCount = 0;
    let maximumDepth = 0;
    const visit = (nodeId, depth) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      maximumDepth = Math.max(maximumDepth, depth);
      const children = childrenByParent.get(nodeId) || [];
      if (children.length === 0) leafCount += 1;
      for (const childId of children) visit(childId, depth + 1);
    };
    visit(rootId, 0);
    return Object.freeze({ rootId, nodeCount: visited.size, leafCount, maximumDepth });
  });
  const sharedGroups = new Map();
  for (const entry of decomposition.entries.filter((item) => item.shared)) {
    const group = sharedGroups.get(entry.membershipKey) || {
      ownerIds: entry.ownerIds,
      nodeIds: []
    };
    group.nodeIds.push(entry.nodeId);
    sharedGroups.set(entry.membershipKey, group);
  }
  return Object.freeze({
    branches: Object.freeze(branches),
    sharedGroups: Object.freeze([...sharedGroups.values()].map((group) => Object.freeze({
      ownerIds: group.ownerIds,
      nodeCount: group.nodeIds.length,
      nodeIds: Object.freeze(group.nodeIds.toSorted(compareIds))
    }))),
    childrenByParent: new Map([...childrenByParent].map(([parentId, children]) =>
      [parentId, Object.freeze([...children])]))
  });
}

function inferVisualRanks(entries, nodeById, tolerance = 2) {
  const ordered = entries.map(({ nodeId }) => nodeById.get(nodeId))
    .filter(Boolean)
    .toSorted((left, right) => Number(left.x) - Number(right.x) || compareIds(left.id, right.id));
  const result = new Map();
  let rank = -1;
  let anchor = null;
  for (const node of ordered) {
    const x = Number(node.x);
    if (anchor === null || Math.abs(x - anchor) > tolerance) {
      rank += 1;
      anchor = x;
    }
    result.set(node.id, rank);
  }
  return result;
}

/** Place each membership group as one contiguous per-layer interval. Shared
 * groups are ordered by the centre of their owner branches, making overlap a
 * visible bridge rather than silently assigning it to either tree. */
export function applyFocusedFaninTreeBlockPlacement(nodes, edges, levelKeys, {
  minimumY = 0,
  gap = 8,
  groupGap = 96,
  targetCenter = null
} = {}) {
  const decomposition = buildFocusedFaninTreeBlocks(nodes, edges);
  if (decomposition.branchRootIds.length < 2) {
    return Object.freeze({ branchCount: decomposition.branchRootIds.length, layerCount: 0,
      movedNodeCount: 0 });
  }
  const nodeById = new Map((nodes || []).map((node) => [node.id, node]));
  const branchOrder = decomposition.branchRootIds.toSorted((leftId, rightId) => {
    const left = nodeById.get(leftId);
    const right = nodeById.get(rightId);
    return Number(left?.y) - Number(right?.y) || compareIds(leftId, rightId);
  });
  const branchIndex = new Map(branchOrder.map((id, index) => [id, index]));
  const incoming = new Map();
  for (const edge of [...(edges || [])].sort(compareEdges)) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    const sources = incoming.get(edge.target) || [];
    sources.push(edge.source);
    incoming.set(edge.target, sources);
  }
  const layers = groupNodesByLevel(nodes);
  const root = nodeById.get(decomposition.rootId);
  const axis = Number.isFinite(Number(targetCenter))
    ? Number(targetCenter)
    : Number(root?.y) + Number(root?.height) / 2;
  let layerCount = 0;
  let movedNodeCount = 0;
  for (const level of levelKeys || []) {
    if (Number(level) >= Number(root?.level)) continue;
    const layer = layers.get(level) || [];
    const members = layer.filter((node) => decomposition.membershipByNodeId.has(node.id));
    if (members.length < 2) continue;
    const groups = new Map();
    for (const node of members) {
      const entry = decomposition.membershipByNodeId.get(node.id);
      const groupNodes = groups.get(entry.membershipKey) || [];
      groupNodes.push(node);
      groups.set(entry.membershipKey, groupNodes);
    }
    const orderedGroups = [...groups.entries()].map(([key, groupNodes]) => {
      const owners = decomposition.membershipByNodeId.get(groupNodes[0].id).ownerIds;
      const rank = owners.reduce((sum, id) => sum + branchIndex.get(id), 0) / owners.length;
      return {
        key,
        owners,
        rank,
        nodes: groupNodes.toSorted((left, right) =>
          compareTreeBarycenter(left, right, incoming, nodeById,
            decomposition.membershipByNodeId) || comparePlacedNodes(left, right))
      };
    }).sort((left, right) => left.rank - right.rank ||
      left.owners.length - right.owners.length || left.key.localeCompare(right.key));
    const orderedMembers = orderedGroups.flatMap((group) => group.nodes);
    const blockHeight = orderedMembers.reduce((sum, node) => sum + Number(node.height), 0) +
      Math.max(0, orderedMembers.length - 1) * gap +
      Math.max(0, orderedGroups.length - 1) * groupGap;
    let cursor = axis - blockHeight / 2;
    const desired = new Map();
    for (let groupIndex = 0; groupIndex < orderedGroups.length; groupIndex += 1) {
      if (groupIndex > 0) cursor += groupGap;
      for (const node of orderedGroups[groupIndex].nodes) {
        desired.set(node.id, cursor);
        cursor += Number(node.height) + gap;
      }
      cursor -= gap;
    }
    const top = axis - blockHeight / 2;
    const bottom = axis + blockHeight / 2;
    const others = layer.filter((node) => !desired.has(node.id)).sort(comparePlacedNodes);
    const upper = others.filter((node) => centerY(node) < axis);
    const lower = others.filter((node) => centerY(node) >= axis);
    const ordered = [...upper, ...orderedMembers, ...lower];
    const preferred = ordered.map((node) => desired.get(node.id) ??
      (upper.includes(node) ? Math.min(Number(node.y), top - Number(node.height) - gap)
        : Math.max(Number(node.y), bottom + gap)));
    const positions = compactOrderedLayer(ordered, preferred, minimumY, gap);
    for (let index = 0; index < ordered.length; index += 1) {
      if (Math.abs(Number(ordered[index].y) - positions[index]) > 0.001) movedNodeCount += 1;
      ordered[index].y = round(positions[index]);
    }
    layerCount += 1;
  }
  return Object.freeze({
    branchCount: decomposition.branchRootIds.length,
    sharedNodeCount: decomposition.entries.filter((entry) => entry.shared).length,
    layerCount,
    movedNodeCount
  });
}

function emptyDecomposition() {
  return Object.freeze({
    rootId: null,
    branchRootIds: Object.freeze([]),
    entries: Object.freeze([]),
    membershipByNodeId: new Map()
  });
}

function compareNodes(left, right) {
  return compareIds(left.id, right.id);
}

function compareIds(left, right) {
  return String(left).localeCompare(String(right));
}

function compareEdges(left, right) {
  return compareIds(left.source, right.source) || compareIds(left.target, right.target) ||
    compareIds(left.id || "", right.id || "");
}

function comparePlacedNodes(left, right) {
  return Number(left.y) - Number(right.y) || compareIds(left.id, right.id);
}

function compareTreeBarycenter(left, right, incoming, nodeById, membershipByNodeId) {
  return treeBarycenter(left, incoming, nodeById, membershipByNodeId) -
    treeBarycenter(right, incoming, nodeById, membershipByNodeId);
}

function treeBarycenter(node, incoming, nodeById, membershipByNodeId) {
  const membershipKey = membershipByNodeId.get(node.id)?.membershipKey;
  const centers = (incoming.get(node.id) || [])
    .filter((id) => membershipByNodeId.get(id)?.membershipKey === membershipKey)
    .map((id) => nodeById.get(id))
    .filter(Boolean)
    .map(centerY)
    .sort((left, right) => left - right);
  if (centers.length === 0) return centerY(node);
  const middle = Math.floor(centers.length / 2);
  return centers.length % 2 === 1
    ? centers[middle]
    : (centers[middle - 1] + centers[middle]) / 2;
}

function centerY(node) {
  return Number(node.y) + Number(node.height) / 2;
}

function mean(values) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}
