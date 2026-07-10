export function normalizeGraphAliases(graph, options = {}) {
  if (options.showAliases !== false) {
    return graph;
  }

  const assignNodes = new Map(
    (graph?.nodes || []).filter((node) => node.kind === "assign").map((node) => [node.id, node])
  );
  if (assignNodes.size === 0) {
    return graph;
  }

  const incomingByTarget = new Map();
  for (const edge of graph.edges || []) {
    if (assignNodes.has(edge.target) && !incomingByTarget.has(edge.target)) {
      incomingByTarget.set(edge.target, edge);
    }
  }

  if ([...assignNodes.keys()].some((nodeId) => !hasResolvableSource(nodeId, assignNodes, incomingByTarget))) {
    return { ...graph, aliases: [], aliasNormalizationSkipped: true };
  }

  const edges = [];
  for (const edge of graph.edges || []) {
    if (assignNodes.has(edge.target)) {
      continue;
    }
    const resolved = resolveAliasSource(edge, assignNodes, incomingByTarget);
    edges.push(resolved);
  }

  return {
    ...graph,
    nodes: graph.nodes.filter((node) => !assignNodes.has(node.id)),
    edges,
    aliases: [...assignNodes.values()].map((node) => ({
      nodeId: node.id,
      lhs: node.ref?.lhs,
      rhs: node.ref?.rhs
    }))
  };
}

function hasResolvableSource(nodeId, assignNodes, incomingByTarget) {
  const visited = new Set();
  let current = nodeId;
  while (assignNodes.has(current)) {
    if (visited.has(current)) {
      return false;
    }
    visited.add(current);
    const incoming = incomingByTarget.get(current);
    if (!incoming) {
      return false;
    }
    current = incoming.source;
  }
  return true;
}

function resolveAliasSource(edge, assignNodes, incomingByTarget) {
  let source = edge.source;
  let sourcePin = edge.sourcePin;
  const collapsedNodeIds = [];
  const visited = new Set();

  while (assignNodes.has(source) && !visited.has(source)) {
    visited.add(source);
    collapsedNodeIds.push(source);
    const incoming = incomingByTarget.get(source);
    if (!incoming) {
      break;
    }
    source = incoming.source;
    sourcePin = incoming.sourcePin;
  }

  if (collapsedNodeIds.length === 0 || assignNodes.has(source)) {
    return edge;
  }
  return {
    ...edge,
    id: `alias:${edge.id}`,
    source,
    sourcePin,
    collapsedAliasNodeIds: collapsedNodeIds
  };
}
