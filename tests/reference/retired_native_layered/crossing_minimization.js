export const DEFAULT_CROSSING_POLICY = Object.freeze({ sweeps: 8, transposePasses: 0 });

export function MinimizeCrossings(proper, policy = {}) {
  const sweeps = ClampInteger(policy.sweeps, 0, 32, DEFAULT_CROSSING_POLICY.sweeps);
  const transposePasses = ClampInteger(policy.transposePasses, 0, 16, DEFAULT_CROSSING_POLICY.transposePasses);
  const initial = proper.layers.map((layer) => ({ rank: layer.rank, nodeKeys: layer.nodes.map((node) => node.key) }));
  let current = CloneLayers(initial);
  let currentCrossings = CountLayerCrossings(current, proper.segments);
  let best = CloneLayers(current);
  let bestCrossings = currentCrossings;
  let completedSweeps = 0;
  // Crossing counts are non-negative. Once the canonical initial order is
  // already at zero, median sweeps cannot improve it and would only rescan
  // every boundary. This is especially expensive for deep single-node ranks.
  if (bestCrossings === 0 || sweeps === 0) {
    return Object.freeze({
      layers: FreezeLayers(best),
      initialCrossings: currentCrossings,
      crossings: bestCrossings,
      completedSweeps,
      sweepLimit: sweeps,
      transposePassLimit: transposePasses
    });
  }
  for (let sweep = 0; sweep < sweeps; sweep += 1) {
    const forward = sweep % 2 === 0;
    const indexes = forward
      ? Range(1, current.length)
      : Range(0, current.length - 1).reverse();
    for (const layerIndex of indexes) {
      ReorderLayerByMedian(current, layerIndex, forward ? layerIndex - 1 : layerIndex + 1, proper.segments);
      TransposeLayer(current, layerIndex, proper.segments, transposePasses);
    }
    currentCrossings = CountLayerCrossings(current, proper.segments);
    if (currentCrossings < bestCrossings ||
      (currentCrossings === bestCrossings && CompareLayerOrders(current, best) < 0)) {
      best = CloneLayers(current);
      bestCrossings = currentCrossings;
    }
    completedSweeps += 1;
  }
  return Object.freeze({
    layers: FreezeLayers(best),
    initialCrossings: CountLayerCrossings(initial, proper.segments),
    crossings: bestCrossings,
    completedSweeps,
    sweepLimit: sweeps,
    transposePassLimit: transposePasses
  });
}

export function CountLayerCrossings(layers, segments) {
  const orderByNode = BuildOrderIndex(layers);
  const byBoundary = new Map();
  for (const segment of segments) {
    const sourceOrder = orderByNode.get(segment.sourceKey);
    const targetOrder = orderByNode.get(segment.targetKey);
    if (!sourceOrder || !targetOrder || targetOrder.rank - sourceOrder.rank !== 1) continue;
    const list = byBoundary.get(sourceOrder.rank) || [];
    list.push({ source: sourceOrder.order, target: targetOrder.order, key: segment.key });
    byBoundary.set(sourceOrder.rank, list);
  }
  let total = 0;
  for (const values of byBoundary.values()) {
    values.sort((left, right) => left.source - right.source || left.target - right.target || CompareText(left.key, right.key));
    total += CountInversions(values.map((value) => value.target));
  }
  return total;
}

function ReorderLayerByMedian(layers, layerIndex, referenceIndex, segments) {
  const layer = layers[layerIndex];
  const reference = layers[referenceIndex];
  if (!layer || !reference) return;
  const referenceOrder = new Map(reference.nodeKeys.map((key, index) => [key, index]));
  const neighbors = new Map(layer.nodeKeys.map((key) => [key, []]));
  for (const segment of segments) {
    if (neighbors.has(segment.targetKey) && referenceOrder.has(segment.sourceKey)) {
      neighbors.get(segment.targetKey).push(referenceOrder.get(segment.sourceKey));
    }
    if (neighbors.has(segment.sourceKey) && referenceOrder.has(segment.targetKey)) {
      neighbors.get(segment.sourceKey).push(referenceOrder.get(segment.targetKey));
    }
  }
  const prior = new Map(layer.nodeKeys.map((key, index) => [key, index]));
  layer.nodeKeys.sort((left, right) =>
    Median(neighbors.get(left), prior.get(left)) - Median(neighbors.get(right), prior.get(right)) ||
    prior.get(left) - prior.get(right) || CompareText(left, right));
}

function TransposeLayer(layers, layerIndex, segments, passLimit) {
  const keys = layers[layerIndex]?.nodeKeys;
  if (!keys) return;
  for (let pass = 0; pass < passLimit; pass += 1) {
    let improved = false;
    for (let index = 0; index < keys.length - 1; index += 1) {
      const before = CountLayerCrossings(layers, segments);
      [keys[index], keys[index + 1]] = [keys[index + 1], keys[index]];
      const after = CountLayerCrossings(layers, segments);
      if (after < before) improved = true;
      else [keys[index], keys[index + 1]] = [keys[index + 1], keys[index]];
    }
    if (!improved) break;
  }
}

function CountInversions(values) {
  if (values.length < 2) return 0;
  const maximum = Math.max(...values, 0) + 2;
  const tree = new Array(maximum + 1).fill(0);
  let count = 0;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index] + 1;
    count += Query(tree, value - 1);
    Update(tree, value, 1);
  }
  return count;
}

function Query(tree, index) {
  let sum = 0;
  for (let cursor = index; cursor > 0; cursor -= cursor & -cursor) sum += tree[cursor];
  return sum;
}

function Update(tree, index, delta) {
  for (let cursor = index; cursor < tree.length; cursor += cursor & -cursor) tree[cursor] += delta;
}

function BuildOrderIndex(layers) {
  const result = new Map();
  for (const layer of layers) {
    layer.nodeKeys.forEach((key, order) => result.set(key, { rank: layer.rank, order }));
  }
  return result;
}

function Median(values, fallback) {
  if (!values || values.length === 0) return fallback;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function CloneLayers(layers) {
  return layers.map((layer) => ({ rank: layer.rank, nodeKeys: [...layer.nodeKeys] }));
}

function FreezeLayers(layers) {
  return Object.freeze(layers.map((layer) => Object.freeze({ rank: layer.rank, nodeKeys: Object.freeze([...layer.nodeKeys]) })));
}

function CompareLayerOrders(left, right) {
  return left.map((layer) => layer.nodeKeys.join("\u0000")).join("\u0001")
    .localeCompare(right.map((layer) => layer.nodeKeys.join("\u0000")).join("\u0001"));
}

function Range(start, end) {
  return Array.from({ length: Math.max(0, end - start) }, (_, index) => start + index);
}

function ClampInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.floor(number))) : fallback;
}

function CompareText(left, right) {
  return String(left).localeCompare(String(right));
}
