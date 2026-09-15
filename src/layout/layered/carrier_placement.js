import { isDummyNode } from "./longEdgeDummies.js";

export const CARRIER_SLOT_KIND = "layout-carrier-slot";

/**
 * Build the layer view consumed by placement. Logical per-edge dummies affect
 * ordering, but only one physical carrier per net and boundary reserves a
 * track. This prevents a high-fanout net from expanding a layer once per sink.
 */
export function buildCarrierPlacementLayers(layeredGraph, options = {}) {
  const carrierSpan = normalizePositive(options.carrierSpan, 24);
  const minimumFanout = normalizePositive(options.minimumFanout, 1);
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
    const carrierSlots = (boundary?.carriers || [])
      .filter((carrier) => (carrier.physicalNetFanout || carrier.logicalEdgeIds?.length || 0) >= minimumFanout)
      .map((carrier) => {
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

/**
 * Reserve each carrier slot by shifting only the real-node suffix below it.
 * The operation is deterministic and linear in placement entries. Re-running
 * with `applyShift: false` resolves anchors after another placement stage has
 * moved nodes without applying the reservation twice.
 */
export function applyCarrierPlacementSlots(
  positionedNodes,
  placementLayers,
  options = {}
) {
  const applyShift = options.applyShift !== false;
  const nodeById = new Map((positionedNodes || []).map((node) => [node.id, node]));
  const carrierYById = new Map();
  const diagnostics = [];
  let totalShift = 0;

  for (const layer of placementLayers || []) {
    let cumulativeShift = 0;
    for (const entry of layer.entries || []) {
      if (entry.kind === CARRIER_SLOT_KIND) {
        if (applyShift) cumulativeShift += normalizePositive(entry.minimumSpan, 24);
        continue;
      }
      const node = nodeById.get(entry.id);
      if (!node) {
        diagnostics.push({
          code: "layered-carrier-placement-node-missing",
          nodeId: entry.id,
          level: layer.level
        });
        continue;
      }
      if (applyShift && cumulativeShift > 0) node.y += cumulativeShift;
    }
    totalShift = Math.max(totalShift, cumulativeShift);
    resolveLayerCarrierYs(layer, nodeById, carrierYById, diagnostics);
  }

  return { carrierYById, diagnostics, totalShift };
}

function resolveLayerCarrierYs(layer, nodeById, carrierYById, diagnostics) {
  const entries = layer.entries || [];
  let index = 0;
  while (index < entries.length) {
    if (entries[index].kind !== CARRIER_SLOT_KIND) {
      index += 1;
      continue;
    }
    const start = index;
    while (index < entries.length && entries[index].kind === CARRIER_SLOT_KIND) index += 1;
    const slots = entries.slice(start, index);
    const previous = findRealNode(entries, start - 1, -1, nodeById);
    const next = findRealNode(entries, index, 1, nodeById);
    const span = slots.reduce((sum, slot) =>
      sum + normalizePositive(slot.minimumSpan, 24), 0);
    const top = previous
      ? Number(previous.y) + Number(previous.height)
      : next
        ? Number(next.y) - span
        : 0;
    let offset = 0;
    for (const slot of slots) {
      const slotSpan = normalizePositive(slot.minimumSpan, 24);
      const y = top + offset + slotSpan / 2;
      if (!Number.isFinite(y)) {
        diagnostics.push({
          code: "layered-carrier-placement-anchor-missing",
          carrierId: slot.carrierId
        });
      } else {
        carrierYById.set(slot.carrierId, y);
      }
      offset += slotSpan;
    }
  }
}

function findRealNode(entries, start, step, nodeById) {
  for (let index = start; index >= 0 && index < entries.length; index += step) {
    if (entries[index].kind === CARRIER_SLOT_KIND) continue;
    const node = nodeById.get(entries[index].id);
    if (node) return node;
  }
  return null;
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
