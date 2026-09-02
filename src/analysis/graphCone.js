export function analyzeGraphCone(graph, startNodeId, options = {}) {
  const direction = options.direction === "fanin" ? "fanin" : "fanout";
  const maxDepth = normalizeMaxDepth(options.maxDepth);
  const nodes = graph?.nodes || [];
  const edges = graph?.edges || [];
  const graphNodeIds = new Set(nodes.map((node) => node.id));
  const startNodeIds = normalizeStartNodeIds(
    options.startNodeIds === undefined ? startNodeId : options.startNodeIds,
    graphNodeIds
  );
  if (startNodeIds.length === 0) {
    return emptyCone(startNodeId, startNodeIds, direction, maxDepth);
  }

  const adjacency = buildAdjacency(edges, direction);
  const depthByNode = new Map(startNodeIds.map((nodeId) => [nodeId, 0]));
  const queue = [...startNodeIds];

  for (let index = 0; index < queue.length; index += 1) {
    const nodeId = queue[index];
    const depth = depthByNode.get(nodeId);
    if (depth >= maxDepth) {
      continue;
    }
    for (const edge of adjacency.get(nodeId) || []) {
      const nextNodeId = direction === "fanin" ? edge.source : edge.target;
      if (!graphNodeIds.has(nextNodeId) || depthByNode.has(nextNodeId)) {
        continue;
      }
      depthByNode.set(nextNodeId, depth + 1);
      queue.push(nextNodeId);
    }
  }

  const includedNodeIds = new Set(depthByNode.keys());
  const includedEdges = edges.filter((edge) =>
    includedNodeIds.has(edge.source) && includedNodeIds.has(edge.target)
  );
  const immediateNodeIds = queue.filter((nodeId) => depthByNode.get(nodeId) === 1);

  return {
    startNodeId: startNodeIds.length === 1 ? startNodeIds[0] : null,
    startNodeIds,
    direction,
    maxDepth,
    nodeIds: nodes.filter((node) => includedNodeIds.has(node.id)).map((node) => node.id),
    edgeIds: includedEdges.map((edge) => edge.id),
    immediateNodeIds,
    depthByNode,
    maxDepthReached: Math.max(...depthByNode.values())
  };
}

export function createConeGraph(graph, startNodeId, options = {}) {
  const cone = analyzeGraphCone(graph, startNodeId, options);
  const nodeIds = new Set(cone.nodeIds);
  const edgeIds = new Set(cone.edgeIds);
  return {
    ...graph,
    nodes: (graph?.nodes || []).filter((node) => nodeIds.has(node.id)),
    edges: (graph?.edges || []).filter((edge) => edgeIds.has(edge.id)),
    view: {
      mode: cone.direction,
      rootNodeId: startNodeId,
      maxDepth: cone.maxDepth
    }
  };
}

export function analyzeFocusedNeighborhood(graph, startNodeId, options = {}) {
  const faninDepth = normalizeMaxDepth(options.faninDepth ?? 3);
  const fanoutDepth = normalizeMaxDepth(options.fanoutDepth ?? 3);
  const rootNodeIds = normalizeStartNodeIds(
    options.rootNodeIds === undefined ? startNodeId : options.rootNodeIds,
    new Set((graph?.nodes || []).map((node) => node.id))
  );
  const fanin = analyzeGraphCone(graph, rootNodeIds, { direction: "fanin", maxDepth: faninDepth });
  const fanout = analyzeGraphCone(graph, rootNodeIds, { direction: "fanout", maxDepth: fanoutDepth });
  const nodeIds = new Set([
    ...(faninDepth > 0 ? fanin.nodeIds : rootNodeIds),
    ...(fanoutDepth > 0 ? fanout.nodeIds : rootNodeIds)
  ]);
  const includedEdges = (graph?.edges || []).filter((edge) =>
    nodeIds.has(edge.source) && nodeIds.has(edge.target)
  );
  const cutEdges = (graph?.edges || []).filter((edge) =>
    nodeIds.has(edge.source) !== nodeIds.has(edge.target)
  );
  return {
    startNodeId: rootNodeIds.length === 1 ? rootNodeIds[0] : null,
    rootNodeIds,
    faninDepth,
    fanoutDepth,
    nodeIds: (graph?.nodes || []).filter((node) => nodeIds.has(node.id)).map((node) => node.id),
    edgeIds: includedEdges.map((edge) => edge.id),
    cutEdges,
    fanin,
    fanout
  };
}

export function createFocusedNeighborhoodGraph(graph, startNodeId, options = {}) {
  const focused = analyzeFocusedNeighborhood(graph, startNodeId, options);
  const nodeIds = new Set(focused.nodeIds);
  const edgeIds = new Set(focused.edgeIds);
  const rootNodeIds = new Set(focused.rootNodeIds);
  const activeRootNodeId = rootNodeIds.has(options.activeRootNodeId)
    ? options.activeRootNodeId
    : focused.rootNodeIds[0] || null;
  const view = {
    mode: "focused",
    rootNodeId: focused.rootNodeIds.length === 1 ? focused.rootNodeIds[0] : null,
    faninDepth: focused.faninDepth,
    fanoutDepth: focused.fanoutDepth
  };
  if (focused.rootNodeIds.length > 1) view.rootNodeIds = [...focused.rootNodeIds];
  return {
    ...graph,
    nodes: (graph?.nodes || [])
      .filter((node) => nodeIds.has(node.id))
      .map((node) => rootNodeIds.has(node.id)
        ? {
          ...node,
          isFocusedRoot: true,
          isActiveFocusedRoot: node.id === activeRootNodeId
        }
        : node),
    edges: (graph?.edges || []).filter((edge) => edgeIds.has(edge.id)),
    view,
    focusBoundary: focused.cutEdges
  };
}

function buildAdjacency(edges, direction) {
  const adjacency = new Map();
  for (const edge of edges) {
    const nodeId = direction === "fanin" ? edge.target : edge.source;
    if (!adjacency.has(nodeId)) {
      adjacency.set(nodeId, []);
    }
    adjacency.get(nodeId).push(edge);
  }
  for (const edgeList of adjacency.values()) {
    edgeList.sort((left, right) => {
      const leftKey = `${String(left.id ?? "")}\\u0000${String(left.source ?? "")}\\u0000${String(left.target ?? "")}`;
      const rightKey = `${String(right.id ?? "")}\\u0000${String(right.source ?? "")}\\u0000${String(right.target ?? "")}`;
      return leftKey.localeCompare(rightKey);
    });
  }
  return adjacency;
}

function normalizeMaxDepth(value) {
  if (value === undefined || value === null || value === Infinity) {
    return Infinity;
  }
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : Infinity;
}

function emptyCone(startNodeId, startNodeIds, direction, maxDepth) {
  return {
    startNodeId: startNodeIds.length === 1 ? startNodeIds[0] : startNodeId || null,
    startNodeIds,
    direction,
    maxDepth,
    nodeIds: [],
    edgeIds: [],
    immediateNodeIds: [],
    depthByNode: new Map(),
    maxDepthReached: 0
  };
}

function normalizeStartNodeIds(value, graphNodeIds) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.filter((nodeId) => graphNodeIds.has(nodeId)))].sort((left, right) =>
    String(left).localeCompare(String(right))
  );
}
