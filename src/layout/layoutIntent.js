export function analyzeLayoutIntent(graph, levels) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const netGroups = new Map();
  for (const edge of graph.edges) {
    const key = getNetGroupKey(edge);
    if (!netGroups.has(key)) netGroups.set(key, []);
    netGroups.get(key).push(edge);
  }

  const edgeIntents = new Map();
  const nodeFanout = new Map();
  const boundaryPressure = new Map();
  for (const [key, edges] of netGroups) {
    const source = nodeById.get(edges[0]?.source);
    const ranked = edges.toSorted((left, right) =>
      compareTargetPriority(left, right, source, nodeById, levels)
    );
    const primaryEdgeId = ranked[0]?.id;
    const fanout = edges.length;
    const sourceLevel = levels.get(edges[0]?.source) || 0;
    nodeFanout.set(edges[0]?.source, Math.max(nodeFanout.get(edges[0]?.source) || 1, fanout));

    for (const [rank, edge] of ranked.entries()) {
      const targetLevel = levels.get(edge.target) ?? sourceLevel + 1;
      edgeIntents.set(edge.id, {
        groupKey: key,
        fanout,
        rank,
        isPrimary: edge.id === primaryEdgeId,
        sourceLevel,
        targetLevel,
        depth: Math.max(1, targetLevel - sourceLevel),
        sourceKind: source?.kind,
        targetKind: nodeById.get(edge.target)?.kind
      });
      nodeFanout.set(edge.target, Math.max(nodeFanout.get(edge.target) || 1, fanout));
      if (fanout > 1) {
        for (let level = sourceLevel; level < targetLevel; level += 1) {
          boundaryPressure.set(level, Math.max(boundaryPressure.get(level) || 1, fanout));
        }
      }
    }
  }

  return {
    edgeIntents,
    netGroups,
    nodeFanout,
    boundaryPressure,
    getEdge(edgeOrId) {
      return edgeIntents.get(typeof edgeOrId === "string" ? edgeOrId : edgeOrId?.id);
    },
    getBoundaryPressure(level) {
      return boundaryPressure.get(level) || 1;
    },
    getNodeFanout(nodeOrId) {
      return nodeFanout.get(typeof nodeOrId === "string" ? nodeOrId : nodeOrId?.id) || 1;
    }
  };
}

export function compareEdgesByLayoutPriority(left, right, layoutIntent) {
  const leftIntent = layoutIntent.getEdge(left) || {};
  const rightIntent = layoutIntent.getEdge(right) || {};
  const leftClass = edgePriorityClass(leftIntent);
  const rightClass = edgePriorityClass(rightIntent);
  if (leftClass !== rightClass) return leftClass - rightClass;
  if ((leftIntent.depth || 1) !== (rightIntent.depth || 1)) {
    return (leftIntent.depth || 1) - (rightIntent.depth || 1);
  }
  if ((leftIntent.rank || 0) !== (rightIntent.rank || 0)) {
    return (leftIntent.rank || 0) - (rightIntent.rank || 0);
  }
  return String(left.id || "").localeCompare(String(right.id || ""));
}

function edgePriorityClass(intent) {
  if (intent.fanout === 1) return 0;
  if (intent.isPrimary && intent.sourceKind === "cell" && intent.targetKind === "cell") return 1;
  if (intent.isPrimary) return 2;
  return 3;
}

function compareTargetPriority(left, right, source, nodeById, levels) {
  const sourceLevel = levels.get(source?.id) || 0;
  const leftTarget = nodeById.get(left.target);
  const rightTarget = nodeById.get(right.target);
  const leftDepth = Math.max(1, (levels.get(left.target) ?? sourceLevel + 1) - sourceLevel);
  const rightDepth = Math.max(1, (levels.get(right.target) ?? sourceLevel + 1) - sourceLevel);
  if (leftDepth !== rightDepth) return leftDepth - rightDepth;

  const leftCellLink = source?.kind === "cell" && leftTarget?.kind === "cell" ? 0 : 1;
  const rightCellLink = source?.kind === "cell" && rightTarget?.kind === "cell" ? 0 : 1;
  if (leftCellLink !== rightCellLink) return leftCellLink - rightCellLink;

  return `${left.target}:${left.targetPin || ""}`.localeCompare(
    `${right.target}:${right.targetPin || ""}`
  );
}

function getNetGroupKey(edge) {
  return `${edge.source}\u0000${edge.net || edge.label || edge.id}`;
}
