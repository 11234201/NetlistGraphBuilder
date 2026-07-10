export function analyzeGraphCone(graph, startNodeId, options = {}) {
  const direction = options.direction === "fanin" ? "fanin" : "fanout";
  const maxDepth = normalizeMaxDepth(options.maxDepth);
  const nodes = graph?.nodes || [];
  const edges = graph?.edges || [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (!nodeIds.has(startNodeId)) {
    return emptyCone(startNodeId, direction, maxDepth);
  }

  const adjacency = buildAdjacency(edges, direction);
  const depthByNode = new Map([[startNodeId, 0]]);
  const queue = [startNodeId];

  for (let index = 0; index < queue.length; index += 1) {
    const nodeId = queue[index];
    const depth = depthByNode.get(nodeId);
    if (depth >= maxDepth) {
      continue;
    }
    for (const edge of adjacency.get(nodeId) || []) {
      const nextNodeId = direction === "fanin" ? edge.source : edge.target;
      if (!nodeIds.has(nextNodeId) || depthByNode.has(nextNodeId)) {
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
    startNodeId,
    direction,
    maxDepth,
    nodeIds: nodes.filter((node) => includedNodeIds.has(node.id)).map((node) => node.id),
    edgeIds: includedEdges.map((edge) => edge.id),
    immediateNodeIds,
    depthByNode,
    maxDepthReached: Math.max(...depthByNode.values())
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
  return adjacency;
}

function normalizeMaxDepth(value) {
  if (value === undefined || value === null || value === Infinity) {
    return Infinity;
  }
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : Infinity;
}

function emptyCone(startNodeId, direction, maxDepth) {
  return {
    startNodeId,
    direction,
    maxDepth,
    nodeIds: [],
    edgeIds: [],
    immediateNodeIds: [],
    depthByNode: new Map(),
    maxDepthReached: 0
  };
}
