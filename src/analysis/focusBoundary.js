import { createGraphAliasIndex, expandGraphAliases } from "./aliasNormalizer.js";

/**
 * Project Focused cut edges into explicit, derived boundary nodes.
 *
 * The full graph remains the source of truth. Boundary nodes only describe
 * logic hidden by the current Focused depth and are never fed back into cone
 * analysis.
 */
export function projectFocusedBoundaries(graph, options = {}) {
  if (!graph || graph.view?.mode !== "focused" || graph.focusBoundaryProjected) {
    return graph;
  }

  const includedNodeIds = new Set((graph.nodes || []).map((node) => node.id));
  const cutEdges = Array.isArray(graph.focusBoundary) ? graph.focusBoundary : [];
  const faninEnabled = Number(graph.view?.faninDepth) > 0;
  const fanoutEnabled = Number(graph.view?.fanoutDepth) > 0;
  const retainFanoutContinuations = options.retainFanoutContinuations === true;
  const aliasGroups = options.fullGraph ? collapsedAliasGroups(options.fullGraph) : new Map();
  const physicalNetKey = (edge) => `${String(edge.source ?? "")}\u0000${String(
    aliasGroups.get(edge.net) ?? edge.net ?? edge.label ?? edge.id ?? "")}`;
  const visibleNets = new Map();
  const visibleEdgesByNet = new Map();
  if (retainFanoutContinuations) {
    for (const edge of graph.edges || []) {
      const netGroupKey = `${String(edge.source ?? "")}\u0000${String(edge.net ?? edge.label ?? edge.id ?? "")}`;
      const previousEdge = visibleEdgesByNet.get(netGroupKey);
      if (!previousEdge || String(edge.id || "").localeCompare(String(previousEdge.id || "")) < 0) {
        visibleEdgesByNet.set(netGroupKey, edge);
      }
      const key = physicalNetKey(edge);
      const previousGroup = visibleNets.get(key);
      if (previousGroup === undefined || netGroupKey.localeCompare(previousGroup) < 0) {
        visibleNets.set(key, netGroupKey);
      }
    }
  }
  const groups = new Map();

  for (const edge of cutEdges) {
    const sourceIncluded = includedNodeIds.has(edge.source);
    const targetIncluded = includedNodeIds.has(edge.target);
    const direction = !sourceIncluded && targetIncluded
      ? faninEnabled ? "in" : null
      : sourceIncluded && !targetIncluded
        ? fanoutEnabled || visibleNets.has(physicalNetKey(edge)) ? "out" : null
        : null;
    if (!direction) continue;
    let netGroupKey = `${String(edge.source ?? "")}\u0000${String(edge.net ?? edge.label ?? edge.id ?? "")}`;
    if (direction === "out" && !visibleEdgesByNet.has(netGroupKey)) {
      netGroupKey = visibleNets.get(physicalNetKey(edge)) ?? netGroupKey;
    }
    const groupKey = `${direction}\u0000${netGroupKey}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(edge);
  }

  // A visible input boundary represents the physical driver of its net. Its
  // other loads can be outside the query too, so neither endpoint of those
  // branches appears in cutEdges. Retain those continuations with one full
  // graph scan, without expanding the visible cell neighborhood.
  if (faninEnabled && (fanoutEnabled || retainFanoutContinuations) && options.fullGraph) {
    const inputByAliasGroup = new Map();
    for (const [groupKey, inputEdges] of groups) {
      if (!groupKey.startsWith("in\u0000")) continue;
      const first = inputEdges[0];
      const aliasGroup = aliasGroups.get(first.net);
      if (aliasGroup === undefined) continue;
      const physicalKey = `${String(first.source ?? "")}\u0000${aliasGroup}`;
      const netGroupKey = groupKey.slice(3);
      const previous = inputByAliasGroup.get(physicalKey);
      if (previous === undefined || netGroupKey.localeCompare(previous) < 0) {
        inputByAliasGroup.set(physicalKey, netGroupKey);
      }
    }
    for (const edge of options.fullGraph.edges || []) {
      if (includedNodeIds.has(edge.source) || includedNodeIds.has(edge.target)) continue;
      let netGroupKey = `${String(edge.source ?? "")}\u0000${String(edge.net ?? edge.label ?? edge.id ?? "")}`;
      if (!groups.has(`in\u0000${netGroupKey}`)) {
        const aliasGroup = aliasGroups.get(edge.net);
        netGroupKey = aliasGroup === undefined ? undefined
          : inputByAliasGroup.get(`${String(edge.source ?? "")}\u0000${aliasGroup}`);
        if (netGroupKey === undefined) continue;
      }
      const groupKey = `out\u0000${netGroupKey}`;
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push(edge);
    }
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
    const netGroupKey = groupKey.slice(direction.length + 1);
    // A folded alias branch must keep the visible branch's wire identity and
    // label. Its hidden endpoints/lineage still come from the original branch.
    const externalInput = direction === "out" && !includedNodeIds.has(first.source)
      ? groups.get(`in\u0000${netGroupKey}`) : null;
    const displayEdge = externalInput?.toSorted((left, right) =>
      String(left.id || "").localeCompare(String(right.id || "")))[0]
      || (direction === "out" ? visibleEdgesByNet.get(netGroupKey) : null) || first;
    const net = String(displayEdge.net ?? "");
    const label = displayEdge.label || net;
    const id = `focus-boundary:${direction}:${safeId(netGroupKey)}`;
    const hiddenEndpointIds = [...new Set(groupedEdges.map(
      (edge) => direction === "in" ? edge.source : edge.target
    ))].toSorted((left, right) => String(left).localeCompare(String(right)));
    const node = {
      id,
      kind: direction === "in" ? "focus-input" : "focus-output",
      label,
      title: direction === "in" ? "FANIN CONTINUES" : "FANOUT CONTINUES",
      subtitle: "Focused boundary",
      ref: { name: net, displayName: label },
      netGroupKey,
      boundaryDirection: direction,
      hiddenEndpointCount: hiddenEndpointIds.length,
      hiddenEndpointIds
    };
    nodes.push(node);

    const sortedEdges = groupedEdges.toSorted((left, right) =>
      String(left.id || "").localeCompare(String(right.id || "")));
    if (direction === "out") {
      const externalSource = !includedNodeIds.has(first.source);
      const derived = {
        ...first,
        id: `${first.id}:focus-out`,
        ...(displayEdge !== first ? { net, label, sourcePin: displayEdge.sourcePin } : {}),
        ...(externalSource ? {
          source: `focus-boundary:in:${safeId(netGroupKey)}`,
          sourcePin: label,
          net,
          label
        } : {}),
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

function collapsedAliasGroups(graph) {
  const groups = new Map();
  if (!graph.aliases?.length) return groups;
  const index = createGraphAliasIndex(graph);
  for (const name of index.keys()) {
    if (groups.has(name)) continue;
    const aliases = [...expandGraphAliases([name], index)].sort();
    for (const alias of aliases) groups.set(alias, aliases[0]);
  }
  return groups;
}

function safeId(value) {
  const normalized = [...String(value)]
    .map((character) => character.codePointAt(0).toString(16))
    .join(".");
  return normalized || "unnamed";
}
