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
  const enforceEntryOrder = options.enforceEntryOrder === true;
  const useActualGaps = options.useActualGaps === true;
  const nodeById = new Map((positionedNodes || []).map((node) => [node.id, node]));
  const carrierYById = new Map();
  const diagnostics = [];
  let totalShift = 0;

  for (const layer of placementLayers || []) {
    if (applyShift && useActualGaps) {
      totalShift = Math.max(
        totalShift,
        placeLayerInActualGaps(layer, nodeById, carrierYById, diagnostics)
      );
      continue;
    }
    if (applyShift && enforceEntryOrder) {
      totalShift = Math.max(
        totalShift,
        placeLayerInEntryOrder(layer, nodeById, carrierYById, diagnostics, options)
      );
      continue;
    }
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

function placeLayerInActualGaps(layer, nodeById, carrierYById, diagnostics) {
  const realNodes = (layer.entries || [])
    .filter((entry) => entry.kind !== CARRIER_SLOT_KIND)
    .map((entry) => nodeById.get(entry.id))
    .filter(Boolean)
    .toSorted((left, right) => Number(left.y) - Number(right.y) ||
      String(left.id).localeCompare(String(right.id)));
  const slots = (layer.entries || []).filter((entry) => entry.kind === CARRIER_SLOT_KIND);
  if (slots.length === 0) return 0;
  const maximumRank = Math.max(
    1,
    ...(layer.entries || []).map((entry) =>
      Number.isFinite(entry.preferredRank) ? entry.preferredRank : 0)
  );
  const slotsByGap = new Map();
  for (const slot of slots) {
    const ratio = Number.isFinite(slot.preferredRank)
      ? slot.preferredRank / maximumRank
      : 1;
    const gapIndex = Math.max(0, Math.min(
      realNodes.length,
      Math.round(ratio * realNodes.length)
    ));
    const entries = slotsByGap.get(gapIndex) || [];
    entries.push(slot);
    slotsByGap.set(gapIndex, entries);
  }

  let totalShift = 0;
  for (const [gapIndex, gapSlots] of [...slotsByGap].toSorted(([left], [right]) => left - right)) {
    gapSlots.sort((left, right) => finiteOr(left.carrierOrder, Infinity) -
      finiteOr(right.carrierOrder, Infinity) || String(left.id).localeCompare(String(right.id)));
    const requiredSpan = gapSlots.reduce((sum, slot) =>
      sum + normalizePositive(slot.minimumSpan, 24), 0);
    const previous = realNodes[gapIndex - 1] || null;
    const next = realNodes[gapIndex] || null;
    const top = previous
      ? Number(previous.y) + Number(previous.height)
      : next
        ? Number(next.y) - requiredSpan
        : 0;
    const availableSpan = previous && next
      ? Math.max(0, Number(next.y) - top)
      : requiredSpan;
    const shift = Math.max(0, requiredSpan - availableSpan);
    if (shift > 0) {
      for (let index = gapIndex; index < realNodes.length; index += 1) {
        realNodes[index].y += shift;
      }
      totalShift += shift;
    }
    let offset = 0;
    for (const slot of gapSlots) {
      const span = normalizePositive(slot.minimumSpan, 24);
      const y = top + offset + span / 2;
      if (Number.isFinite(y)) carrierYById.set(slot.carrierId, y);
      else diagnostics.push({
        code: "layered-carrier-placement-anchor-missing",
        carrierId: slot.carrierId
      });
      offset += span;
    }
  }
  return totalShift;
}

function placeLayerInEntryOrder(layer, nodeById, carrierYById, diagnostics, options) {
  const realNodes = (layer.entries || [])
    .filter((entry) => entry.kind !== CARRIER_SLOT_KIND)
    .map((entry) => nodeById.get(entry.id))
    .filter(Boolean);
  let cursor = realNodes.length > 0
    ? Math.min(...realNodes.map((node) => Number(node.y)))
    : 0;
  const start = cursor;
  const nodeGap = Math.max(0, Number(options.nodeGap) || 0);
  for (const entry of layer.entries || []) {
    if (entry.kind === CARRIER_SLOT_KIND) {
      const span = normalizePositive(entry.minimumSpan, 24);
      carrierYById.set(entry.carrierId, cursor + span / 2);
      cursor += span;
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
    node.y = cursor;
    cursor += Number(node.height) + nodeGap;
  }
  return cursor - start;
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
