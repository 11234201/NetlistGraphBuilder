export function resolveFocusedRootTarget(fullGraph, selectedNodeId, currentRootNodeId, viewMode) {
  const selected = fullGraph?.nodes?.find(
    (node) => node.id === selectedNodeId && node.kind === "cell"
  );
  if (!selected) return null;
  if (viewMode === "focused" && selected.id === currentRootNodeId) return null;
  return selected.id;
}
