// Intentionally exhaustive, independent reference for small unit-length DAGs only.
export function exhaustiveRankObjective(nodeIds, edges) {
  if (nodeIds.length > 6 || edges.some((edge) => edge.minimumLength !== 1)) {
    throw new Error('Exhaustive rank reference bound exceeded');
  }
  const ranks = new Map(), rankCount = Math.max(1, nodeIds.length);
  let minimum = Infinity;
  const enumerate = (index) => {
    if (index === nodeIds.length) {
      if (Math.min(...ranks.values()) !== 0 && nodeIds.length) return;
      let objective = 0;
      for (const edge of edges) {
        const span = ranks.get(edge.targetNodeId) - ranks.get(edge.sourceNodeId);
        if (span < edge.minimumLength) return;
        objective += edge.weight * span;
      }
      minimum = Math.min(minimum, objective);
      return;
    }
    for (let rank = 0; rank < rankCount; rank++) {
      ranks.set(nodeIds[index], rank); enumerate(index + 1);
    }
  };
  enumerate(0);
  return minimum;
}
