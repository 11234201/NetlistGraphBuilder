/**
 * Search activation is allowed to change the visible query only when the
 * target is not already present in the positioned canvas graph.  Keep this
 * decision independent from DOM/rendering so Single and future Compare
 * handlers can share the same rule.
 */
export function isSearchTargetPositioned(target, graph) {
  if (!target || !graph) return false;
  if (target.kind === "net") {
    return Boolean(target.name) && (graph.edges || []).some((edge) => edge.net === target.name);
  }
  if (target.kind === "cell") {
    return Boolean(target.name) && (graph.nodes || []).some((node) =>
      node.kind === "cell" && node.ref?.instance === target.name
    );
  }
  if (target.kind === "port") {
    const preferredKind = target.direction === "output" ? "output" : "input";
    return Boolean(target.name) && (graph.nodes || []).some((node) =>
      node.kind === preferredKind && node.ref?.name === target.name
    );
  }
  return false;
}

export function shouldRevealSearchTarget(target, positionedGraph, fullGraph) {
  if (!target || !fullGraph || isSearchTargetPositioned(target, positionedGraph)) return false;
  if (target.kind !== "cell" && target.kind !== "net") return false;
  return isSearchTargetPositioned(target, fullGraph);
}

/**
 * Resolve the only three search outcomes the application may perform.  A
 * target already represented by the positioned graph is merely located; a
 * cell/net that exists only in the full graph is promoted through Focused;
 * everything else is reported as unavailable instead of creating an
 * invisible selection.
 */
export function resolveSearchTargetAction(target, positionedGraph, fullGraph) {
  if (isSearchTargetPositioned(target, positionedGraph)) return "locate";
  if (shouldRevealSearchTarget(target, positionedGraph, fullGraph)) return "focus";
  return "unavailable";
}
