export function orderPhysicalNetCarriers(layeredGraph) {
  const layersByLevel = new Map((layeredGraph.layers || []).map((layer) => [layer.level, layer]));
  const edgeById = new Map((layeredGraph.orientedEdges || []).map((edge) => [String(edge.id || ""), edge]));
  const dummyByEdgeAndLevel = new Map((layeredGraph.logicalChains?.dummies || []).map((dummy) => [
    `${dummy.realEdgeId}\u0000${dummy.level}`,
    dummy
  ]));
  const byBoundary = new Map();
  const diagnostics = [];

  for (const carrier of layeredGraph.carriers || []) {
    const layer = layersByLevel.get(carrier.rightLevel);
    const rankByNode = new Map((layer?.nodes || []).map((node, index) => [node.id, index]));
    const ranks = carrier.logicalEdgeIds.flatMap((edgeId) => {
      const dummy = dummyByEdgeAndLevel.get(`${edgeId}\u0000${carrier.rightLevel}`);
      const edge = edgeById.get(edgeId);
      const anchorId = dummy?.id || edge?.target;
      const rank = rankByNode.get(anchorId);
      return Number.isFinite(rank) ? [rank] : [];
    }).toSorted((left, right) => left - right);
    if (ranks.length === 0) {
      diagnostics.push({ code: "layered-carrier-anchor-missing", carrierId: carrier.id });
    }
    const preferredRank = ranks.length === 0
      ? Number.POSITIVE_INFINITY
      : ranks[Math.floor((ranks.length - 1) / 2)];
    const entries = byBoundary.get(carrier.boundaryColumn) || [];
    entries.push({ ...carrier, preferredRank });
    byBoundary.set(carrier.boundaryColumn, entries);
  }

  const boundaries = [...byBoundary.entries()]
    .toSorted(([left], [right]) => left - right)
    .map(([boundaryColumn, carriers]) => ({
      boundaryColumn,
      leftLevel: carriers[0].leftLevel,
      rightLevel: carriers[0].rightLevel,
      carriers: carriers
        .toSorted(compareCarriers)
        .map((carrier, order) => ({ ...carrier, order }))
    }));
  return { boundaries, diagnostics };
}

function compareCarriers(left, right) {
  if (Number.isFinite(left.preferredRank) && Number.isFinite(right.preferredRank)) {
    const rankDifference = left.preferredRank - right.preferredRank;
    if (rankDifference !== 0) return rankDifference;
  } else if (Number.isFinite(left.preferredRank)) {
    return -1;
  } else if (Number.isFinite(right.preferredRank)) {
    return 1;
  }
  return String(left.netGroupKey || "").localeCompare(String(right.netGroupKey || ""));
}
