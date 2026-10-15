/**
 * NLR-06 — boundary width and rank x projection.
 *
 * Slot count owns the width of an inter-layer boundary; nothing is preallocated
 * and no channel is expanded before the shared segment structure is known.
 * Node columns consume x first, exactly as ELK's `OrthogonalEdgeRouter` does,
 * and only then does the gap measurement advance the cursor.
 */

export const DEFAULT_PROJECTION_POLICY = Object.freeze({
  margin: 40,
  edgeEdgeSpacing: 12,
  edgeNodeSpacing: 24,
  nodeNodeSpacing: 104
});

export function ProjectRankCoordinates(rankWidths, slotCountByBoundary, policy = {}) {
  const normalized = NormalizePolicy(policy);
  const ranks = [...rankWidths.keys()].sort((left, right) => left - right);
  const rankX = new Map();
  const startPosByBoundary = new Map();
  const boundaryWidthByBoundary = new Map();
  let x = normalized.margin;

  for (let index = 0; index < ranks.length; index += 1) {
    const rank = ranks[index];
    rankX.set(rank, Round(x));
    x += Math.max(0, Number(rankWidths.get(rank)) || 0);
    if (index === ranks.length - 1) break;
    const slotCount = Math.max(0, Number(slotCountByBoundary.get(rank)) || 0);
    const startPos = x + normalized.edgeNodeSpacing;
    const width = slotCount > 0
      ? Math.max((slotCount - 1) * normalized.edgeEdgeSpacing + normalized.edgeNodeSpacing * 2,
        normalized.nodeNodeSpacing)
      : normalized.nodeNodeSpacing;
    startPosByBoundary.set(rank, Round(startPos));
    boundaryWidthByBoundary.set(rank, Round(width));
    x += width;
  }

  return Object.freeze({
    rankX,
    startPosByBoundary,
    boundaryWidthByBoundary,
    width: Round(x),
    policy: Object.freeze(normalized)
  });
}

function NormalizePolicy(policy) {
  const positive = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };
  return {
    margin: positive(policy.margin, DEFAULT_PROJECTION_POLICY.margin),
    edgeEdgeSpacing: positive(policy.edgeEdgeSpacing, DEFAULT_PROJECTION_POLICY.edgeEdgeSpacing),
    edgeNodeSpacing: positive(policy.edgeNodeSpacing, DEFAULT_PROJECTION_POLICY.edgeNodeSpacing),
    nodeNodeSpacing: Math.max(0, positive(policy.nodeNodeSpacing, DEFAULT_PROJECTION_POLICY.nodeNodeSpacing))
  };
}

function Round(value) {
  return Math.round(value * 1000) / 1000;
}
