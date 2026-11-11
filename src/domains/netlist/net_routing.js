import { createGraphAliasIndex, expandGraphAliases } from "../../analysis/aliasNormalizer.js";

// Routing exclusions are view overrides. The full connectivity graph remains
// available to search, inspection, timing and Focused traversal.
export function normalizeUnroutedNets(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .filter((name) => typeof name === "string" && name.length > 0))].sort();
}

export function cloneNetRoutingOverrides(value) {
  const unroutedNets = normalizeUnroutedNets(value?.unroutedNets);
  return unroutedNets.length ? { unroutedNets } : {};
}

export function resolveUnroutedNets(graph, names) {
  const excluded = new Set(normalizeUnroutedNets(names));
  if (!excluded.size) return excluded;
  return expandGraphAliases(excluded, createGraphAliasIndex(graph));
}

export function setNetRoutingEnabled(overrides, graph, netName, enabled) {
  const names = new Set(normalizeUnroutedNets(overrides?.unroutedNets));
  if (enabled) {
    for (const alias of resolveUnroutedNets(graph, [netName])) names.delete(alias);
  } else {
    names.add(netName);
  }
  const { unroutedNets: previous, ...rest } = overrides || {};
  return { ...rest, ...cloneNetRoutingOverrides({ unroutedNets: [...names] }) };
}

export function omitUnroutedNets(graph, names, fullGraph = graph) {
  const requested = normalizeUnroutedNets(names);
  if (!requested.length) return graph;
  const aliases = createGraphAliasIndex(fullGraph);
  const excluded = expandGraphAliases(requested, aliases);
  const excludedAssigns = new Map(graph.nodes
    .filter((node) => node.kind === "assign" && excluded.has(node.ref?.lhs))
    .map((node) => [node.id, node.ref.lhs]));
  const unroutedInView = new Set();
  const edges = graph.edges.filter((edge) => {
    if (excluded.has(edge.net)) {
      unroutedInView.add(edge.net);
      return false;
    }
    // Hide only this assignment's incoming branch, not other consumers of
    // the same constant driver.
    if (excludedAssigns.has(edge.target)) {
      unroutedInView.add(excludedAssigns.get(edge.target));
      return false;
    }
    return true;
  });
  const connected = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  return {
    ...graph,
    // Synthetic Focused boundaries are only useful when they have a wire.
    // Real cells, ports and their pin descriptors always remain intact.
    nodes: graph.nodes.filter((node) =>
      !["focus-input", "focus-output"].includes(node.kind) || connected.has(node.id)),
    edges,
    // Selection/search may inspect a hidden wire without changing the view.
    // Nets outside this query still need the normal Focused reveal path.
    unroutedNets: [...expandGraphAliases(unroutedInView, aliases)].sort()
  };
}
