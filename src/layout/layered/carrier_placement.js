import { isDummyNode } from "./longEdgeDummies.js";

export const CARRIER_SLOT_KIND = "layout-carrier-slot";

/**
 * Build the layer view consumed by placement. Logical per-edge dummies affect
 * ordering, but only one physical carrier per net and boundary reserves a
 * track. This prevents a high-fanout net from expanding a layer once per sink.
 */
export function buildCarrierPlacementLayers(layeredGraph, options = {}) {
  const carrierSpan = normalizePositive(options.carrierSpan, 24);
  const boundaryByRightLevel = new Map((layeredGraph.carrierBoundaries || []).map((boundary) => [
    boundary.rightLevel,
    boundary
  ]));
  const diagnostics = [];
  const layers = (layeredGraph.layers || []).map((layer) => {
    const rankedRealNodes = layer.nodes
      .map((node, rank) => ({ node, rank }))
      .filter(({ node }) => !isDummyNode(node));
    const boundary = boundaryByRightLevel.get(layer.level);
    const carrierSlots = (boundary?.carriers || []).map((carrier) => {
      if (!Number.isFinite(carrier.preferredRank)) {
        diagnostics.push({
          code: "layered-carrier-placement-rank-missing",
          carrierId: carrier.id
        });
      }
      return {
        id: `slot:${carrier.id}`,
        kind: CARRIER_SLOT_KIND,
        carrierId: carrier.id,
        netGroupKey: carrier.netGroupKey,
        level: layer.level,
        boundaryColumn: carrier.boundaryColumn,
        preferredRank: carrier.preferredRank,
        carrierOrder: carrier.order,
        minimumSpan: carrierSpan
      };
    });
    const entries = [
      ...rankedRealNodes.map(({ node, rank }) => ({
        id: node.id,
        kind: "real-node",
        node,
        preferredRank: rank,
        stableOrder: 1
      })),
      ...carrierSlots.map((slot) => ({
        ...slot,
        stableOrder: 0
      }))
    ].toSorted(comparePlacementEntries);
    return { level: layer.level, entries };
  });
  return { layers, diagnostics, carrierSpan };
}

function comparePlacementEntries(left, right) {
  const leftRank = Number.isFinite(left.preferredRank)
    ? left.preferredRank
    : Number.POSITIVE_INFINITY;
  const rightRank = Number.isFinite(right.preferredRank)
    ? right.preferredRank
    : Number.POSITIVE_INFINITY;
  if (leftRank !== rightRank) return leftRank - rightRank;
  if (left.stableOrder !== right.stableOrder) return left.stableOrder - right.stableOrder;
  const carrierOrder = finiteOr(left.carrierOrder, Number.POSITIVE_INFINITY) -
    finiteOr(right.carrierOrder, Number.POSITIVE_INFINITY);
  if (carrierOrder !== 0 && Number.isFinite(carrierOrder)) return carrierOrder;
  return String(left.id || "").localeCompare(String(right.id || ""));
}

function finiteOr(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function normalizePositive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
