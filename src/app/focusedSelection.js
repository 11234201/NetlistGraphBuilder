import { normalizeFocusedRootNodeIds as normalizePolicyRoots } from "./focusedViewPolicy.js";

export function resolveFocusedRootState(value, activeRootNodeId = null, previousActive = null) {
  const rootNodeIds = normalizePolicyRoots(value);
  return {
    rootNodeIds,
    activeRootNodeId: rootNodeIds.includes(activeRootNodeId) ? activeRootNodeId
      : rootNodeIds.includes(previousActive) ? previousActive : rootNodeIds[0] || null
  };
}

export function resolveFocusedRootAction(current, action, policy = undefined) {
  const roots = normalizePolicyRoots(current.rootNodeIds, null, policy);
  const nodeId = action.nodeId;
  let next = roots;
  let rejected = false;
  switch (action.type) {
    case "set": next = nodeId ? [nodeId] : []; break;
    case "add":
      // Reject at capacity without evicting an existing root through sorting.
      next = normalizePolicyRoots([...roots, nodeId], null, policy);
      if (!roots.includes(nodeId) && next.length <= roots.length) {
        next = roots;
        rejected = true;
      }
      break;
    case "remove": next = roots.filter((id) => id !== nodeId); break;
    case "clear": next = []; break;
    case "activate": break;
    default: throw new Error(`Unknown focused action: ${action.type}`);
  }
  const preferred = ["set", "add", "activate"].includes(action.type) && !rejected
    ? nodeId : current.activeRootNodeId;
  const rootNodeIds = normalizePolicyRoots(next, null, policy);
  return {
    rootNodeIds,
    activeRootNodeId: rootNodeIds.includes(preferred) ? preferred
      : rootNodeIds.includes(current.activeRootNodeId) ? current.activeRootNodeId
        : rootNodeIds[0] || null,
    changed: roots.length !== rootNodeIds.length || roots.some((id, index) => id !== rootNodeIds[index]),
    rejected
  };
}

export function resolveFocusedRootTarget(fullGraph, selectedNodeId, currentRootNodeId, viewMode) {
  const selected = fullGraph?.nodes?.find(
    (node) => node.id === selectedNodeId && node.kind === "cell"
  );
  if (!selected) return null;
  const roots = normalizeFocusedRootNodeIds(currentRootNodeId);
  if (viewMode === "focused" && roots.length === 1 && roots[0] === selected.id) return null;
  return selected.id;
}

export function normalizeFocusedRootNodeIds(value, policy = undefined) {
  return normalizePolicyRoots(value, null, policy);
}

export function toggleFocusedRootNodeId(rootNodeIds, nodeId) {
  const roots = normalizeFocusedRootNodeIds(rootNodeIds);
  if (roots.includes(nodeId)) return roots.filter((id) => id !== nodeId);
  return addFocusedRootNodeId(roots, nodeId);
}

export function addFocusedRootNodeId(rootNodeIds, nodeId) {
  if (typeof nodeId !== "string" || nodeId.length === 0) {
    return normalizeFocusedRootNodeIds(rootNodeIds);
  }
  return resolveFocusedRootAction({ rootNodeIds }, { type: "add", nodeId }).rootNodeIds;
}

export function shouldPreserveFocusedRootsForSearch(viewMode, rootNodeIds) {
  return viewMode === "focused" && normalizeFocusedRootNodeIds(rootNodeIds).length > 0;
}
