/**
 * Project Focused cut edges into explicit, derived boundary nodes.
 *
 * The full graph remains the source of truth. Boundary nodes only describe
 * logic hidden by the current Focused depth and are never fed back into cone
 * analysis.
 */
export function projectFocusedBoundaries(graph) {
  if (!graph || graph.view?.mode !== "focused" || graph.focusBoundaryProjected) {
    return graph;
  }

  const includedNodeIds = new Set((graph.nodes || []).map((node) => node.id));
  const cutEdges = Array.isArray(graph.focusBoundary) ? graph.focusBoundary : [];
  const faninEnabled = Number(graph.view?.faninDepth) > 0;
  const fanoutEnabled = Number(graph.view?.fanoutDepth) > 0;
  const groups = new Map();

  for (const edge of cutEdges) {
    const sourceIncluded = includedNodeIds.has(edge.source);
    const targetIncluded = includedNodeIds.has(edge.target);
    const direction = !sourceIncluded && targetIncluded
      ? faninEnabled ? "in" : null
      : sourceIncluded && !targetIncluded
        ? fanoutEnabled ? "out" : null
        : null;
    if (!direction) continue;
    const netGroupKey = `${String(edge.source ?? "")}\u0000${String(edge.net ?? edge.label ?? edge.id ?? "")}`;
    const groupKey = `${direction}\u0000${netGroupKey}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(edge);
  }

  if (groups.size === 0) {
    return { ...graph, focusBoundaryProjected: true, focusBoundaryEdges: [] };
  }

  const nodes = [...graph.nodes];
  const edges = [...graph.edges];
  const projectedEdges = [];
  for (const [groupKey, groupedEdges] of [...groups.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const direction = groupKey.startsWith("in\u0000") ? "in" : "out";
    const first = groupedEdges
      .toSorted((left, right) => String(left.id || "").localeCompare(String(right.id || "")))[0];
    const net = String(first.net ?? "");
    const netGroupKey = groupKey.slice(direction.length + 1);
    const id = `focus-boundary:${direction}:${safeId(netGroupKey)}`;
    const hiddenEndpointIds = [...new Set(groupedEdges.map(
      (edge) => direction === "in" ? edge.source : edge.target
    ))].toSorted((left, right) => String(left).localeCompare(String(right)));
    const node = {
      id,
      kind: direction === "in" ? "focus-input" : "focus-output",
      label: first.label || net,
      title: direction === "in" ? "FANIN CONTINUES" : "FANOUT CONTINUES",
      subtitle: "Focused boundary",
      ref: { name: net, displayName: first.label || net },
      netGroupKey,
      boundaryDirection: direction,
      hiddenEndpointCount: hiddenEndpointIds.length,
      hiddenEndpointIds
    };
    nodes.push(node);

    const sortedEdges = groupedEdges.toSorted((left, right) =>
      String(left.id || "").localeCompare(String(right.id || "")));
    if (direction === "out") {
      const derived = {
        ...first,
        id: `${first.id}:focus-out`,
        target: id,
        targetPin: node.label,
        showLabel: true,
        derivedFromEdgeIds: sortedEdges.map((edge) => edge.id),
        hiddenEndpointCount: hiddenEndpointIds.length,
        focusBoundaryDirection: "out"
      };
      edges.push(derived);
      projectedEdges.push(derived);
      continue;
    }

    for (const [index, edge] of sortedEdges.entries()) {
      const derived = {
          ...edge,
          id: `${edge.id}:focus-in`,
          source: id,
          sourcePin: node.label,
          showLabel: index === 0,
          derivedFromEdgeIds: [edge.id],
          focusBoundaryDirection: "in"
        };
      edges.push(derived);
      projectedEdges.push(derived);
    }
  }

  return {
    ...graph,
    nodes,
    edges,
    focusBoundaryProjected: true,
    focusBoundaryEdges: projectedEdges.map((edge) => edge.id)
  };
}

function safeId(value) {
  const normalized = [...String(value)]
    .map((character) => character.codePointAt(0).toString(16))
    .join(".");
  return normalized || "unnamed";
}
