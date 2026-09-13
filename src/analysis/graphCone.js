export function analyzeGraphCone(graph, startNodeId, options = {}) {
  const direction = options.direction === "fanin" ? "fanin" : "fanout";
  const maxDepth = normalizeMaxDepth(options.maxDepth);
  const nodes = graph?.nodes || [];
  const edges = graph?.edges || [];
  const graphNodeIds = new Set(nodes.map((node) => node.id));
  const requestedStartNodeIds = normalizeStartNodeIds(
    options.startNodeIds === undefined ? startNodeId : options.startNodeIds,
    graphNodeIds
  );
  const maximumVisibleNodes = normalizeBudget(options.maximumVisibleNodes ?? options.maxNodes);
  const startNodeIds = maximumVisibleNodes === Infinity
    ? requestedStartNodeIds
    : requestedStartNodeIds.slice(0, maximumVisibleNodes);
  const hiddenRootNodeCount = requestedStartNodeIds.length - startNodeIds.length;
  if (startNodeIds.length === 0) {
    return emptyCone(startNodeId, startNodeIds, direction, maxDepth, hiddenRootNodeCount);
  }

  const adjacency = buildAdjacency(edges, direction);
  const depthByNode = new Map(startNodeIds.map((nodeId) => [nodeId, 0]));
  const queue = [...startNodeIds];
  const maximumFrontier = normalizeBudget(options.maximumFrontier);
  const frontierByDepth = new Map();
  let hiddenNodeCount = hiddenRootNodeCount;

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
      const nextDepth = depth + 1;
      if (maximumVisibleNodes !== Infinity && depthByNode.size >= maximumVisibleNodes) {
        hiddenNodeCount += 1;
        continue;
      }
      const frontierCount = frontierByDepth.get(nextDepth) || 0;
      if (maximumFrontier !== Infinity && frontierCount >= maximumFrontier) {
        hiddenNodeCount += 1;
        continue;
      }
      depthByNode.set(nextNodeId, depth + 1);
      frontierByDepth.set(nextDepth, frontierCount + 1);
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
    maxDepthReached: Math.max(...depthByNode.values()),
    hiddenNodeCount,
    truncated: hiddenNodeCount > 0
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
  const rootNetIds = normalizeRootNetIds(graph, options.rootNetIds ?? options.rootNetId);
  const netSeedNodeIds = resolveNetSeedNodeIds(graph, rootNetIds);
  const seedNodeIds = normalizeStartNodeIds([...rootNodeIds, ...netSeedNodeIds], new Set((graph?.nodes || []).map((node) => node.id)));
  const fanin = analyzeGraphCone(graph, seedNodeIds, {
    direction: "fanin",
    maxDepth: faninDepth,
    maximumVisibleNodes: options.maximumVisibleNodes,
    maximumFrontier: options.maximumFrontier
  });
  const fanout = analyzeGraphCone(graph, seedNodeIds, {
    direction: "fanout",
    maxDepth: fanoutDepth,
    maximumVisibleNodes: options.maximumVisibleNodes,
    maximumFrontier: options.maximumFrontier
  });
  const candidateNodeIds = new Set([
    ...(faninDepth > 0 ? fanin.nodeIds : seedNodeIds),
    ...(fanoutDepth > 0 ? fanout.nodeIds : seedNodeIds)
  ]);
  const maximumVisibleNodes = normalizeBudget(options.maximumVisibleNodes);
  const orderedCandidateNodeIds = [...candidateNodeIds].sort((left, right) => String(left).localeCompare(String(right)));
  const prioritizedNodeIds = [
    ...seedNodeIds.filter((id) => candidateNodeIds.has(id)),
    ...orderedCandidateNodeIds.filter((id) => !seedNodeIds.includes(id))
  ];
  const visibleNodeIds = maximumVisibleNodes === Infinity
    ? prioritizedNodeIds
    : prioritizedNodeIds.slice(0, maximumVisibleNodes);
  const nodeIds = new Set(visibleNodeIds);
  const includedEdges = (graph?.edges || []).filter((edge) =>
    nodeIds.has(edge.source) && nodeIds.has(edge.target)
  );
  const cutEdges = (graph?.edges || []).filter((edge) =>
    nodeIds.has(edge.source) !== nodeIds.has(edge.target)
  );
  return {
    startNodeId: rootNodeIds.length === 1 ? rootNodeIds[0] : null,
    rootNodeIds,
    rootNetIds,
    netSeedNodeIds,
    faninDepth,
    fanoutDepth,
    nodeIds: (graph?.nodes || []).filter((node) => nodeIds.has(node.id)).map((node) => node.id),
    edgeIds: includedEdges.map((edge) => edge.id),
    cutEdges,
    fanin,
    fanout,
    hiddenEndpointCount: Math.max(
      fanin.hiddenNodeCount || 0,
      fanout.hiddenNodeCount || 0,
      candidateNodeIds.size - visibleNodeIds.length
    ),
    truncated: Boolean(fanin.truncated || fanout.truncated || candidateNodeIds.size !== visibleNodeIds.length),
    netRootDiagnostics: diagnoseNetRoots(graph, rootNetIds)
  };
}

export function createFocusedNeighborhoodGraph(graph, startNodeId, options = {}) {
  const focused = analyzeFocusedNeighborhood(graph, startNodeId, options);
  const nodeIds = new Set(focused.nodeIds);
  const edgeIds = new Set(focused.edgeIds);
  const rootNodeIds = new Set([...focused.rootNodeIds, ...focused.netSeedNodeIds]);
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
  if (focused.rootNetIds.length > 0) {
    view.rootNetIds = focused.rootNetIds;
    view.netRootDiagnostics = focused.netRootDiagnostics;
  }
  if (focused.truncated) {
    view.hiddenEndpointCount = focused.hiddenEndpointCount;
    view.truncated = true;
  }
  return {
    ...graph,
    nodes: (graph?.nodes || [])
      .filter((node) => nodeIds.has(node.id))
      .map((node) => rootNodeIds.has(node.id)
        ? {
          ...node,
          isFocusedRoot: focused.rootNodeIds.includes(node.id),
          isFocusedNetEndpoint: focused.netSeedNodeIds.includes(node.id),
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

function emptyCone(startNodeId, startNodeIds, direction, maxDepth, hiddenNodeCount = 0) {
  return {
    startNodeId: startNodeIds.length === 1 ? startNodeIds[0] : startNodeId || null,
    startNodeIds,
    direction,
    maxDepth,
    nodeIds: [],
    edgeIds: [],
    immediateNodeIds: [],
    depthByNode: new Map(),
    maxDepthReached: 0,
    hiddenNodeCount,
    truncated: hiddenNodeCount > 0
  };
}

function normalizeStartNodeIds(value, graphNodeIds) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.filter((nodeId) => graphNodeIds.has(nodeId)))].sort((left, right) =>
    String(left).localeCompare(String(right))
  );
}

function normalizeRootNetIds(graph, value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  const available = new Set((graph?.edges || []).map((edge) => edge.net).filter(Boolean));
  return [...new Set(values.filter((net) => typeof net === "string" && net.length > 0 && available.has(net)))].sort((left, right) =>
    String(left).localeCompare(String(right))
  );
}

function resolveNetSeedNodeIds(graph, rootNetIds) {
  const roots = new Set(rootNetIds);
  return [...new Set((graph?.edges || []).flatMap((edge) => roots.has(edge.net) ? [edge.source, edge.target] : []))]
    .sort((left, right) => String(left).localeCompare(String(right)));
}

function diagnoseNetRoots(graph, rootNetIds) {
  const byNet = new Map();
  for (const edge of graph?.edges || []) {
    if (!rootNetIds.includes(edge.net)) continue;
    if (!byNet.has(edge.net)) byNet.set(edge.net, { drivers: new Set(), loads: new Set() });
    const entry = byNet.get(edge.net);
    entry.drivers.add(edge.source);
    entry.loads.add(edge.target);
  }
  return rootNetIds.map((net) => {
    const entry = byNet.get(net) || { drivers: new Set(), loads: new Set() };
    const diagnostics = [];
    if (entry.drivers.size === 0) diagnostics.push("missing-driver");
    if (entry.drivers.size > 1) diagnostics.push("multiple-drivers");
    if (entry.loads.size === 0) diagnostics.push("missing-load");
    return { net, driverCount: entry.drivers.size, loadCount: entry.loads.size, diagnostics };
  });
}

function normalizeBudget(value) {
  if (value === undefined || value === null || value === Infinity) return Infinity;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : Infinity;
}
