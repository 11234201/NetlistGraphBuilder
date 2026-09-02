import { normalizeFocusedRootNodeIds as normalizePolicyRoots } from "./focusedViewPolicy.js";

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
  const roots = new Set(normalizeFocusedRootNodeIds(rootNodeIds));
  if (roots.has(nodeId)) roots.delete(nodeId);
  else if (typeof nodeId === "string" && nodeId.length > 0) roots.add(nodeId);
  return normalizeFocusedRootNodeIds([...roots]);
}
