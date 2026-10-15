/**
 * NLD-04A — merge placement dummies that represent the same physical net on
 * the same rank. The physical-net key already includes the canonical driver,
 * so this never joins equal labels owned by different drivers.
 *
 * Logical segments and chains remain distinct. Only their placement anchor is
 * shared, which lets every branch reconstruct its original edge while avoiding
 * one parallel dummy column entry per load.
 */
export function MergeHyperedgeDummies(proper, crossing) {
  const realNodes = proper.nodes.filter((node) => !node.dummy);
  const dummyGroups = new Map();
  for (const node of proper.nodes.filter((entry) => entry.dummy)) {
    const groupKey = `${node.rank}\u0000${node.physicalNetKey}`;
    const values = dummyGroups.get(groupKey) || [];
    values.push(node);
    dummyGroups.set(groupKey, values);
  }

  const replacement = new Map();
  const mergedNodes = [];
  for (const [groupKey, values] of [...dummyGroups].sort(([left], [right]) => CompareText(left, right))) {
    values.sort((left, right) => CompareText(left.key, right.key));
    const first = values[0];
    const key = `dummy:merged:${first.rank}:${first.physicalNetKey}`;
    for (const value of values) replacement.set(value.key, key);
    mergedNodes.push(Object.freeze({
      ...first,
      key,
      logicalEdgeKey: first.logicalEdgeKey,
      logicalEdgeKeys: Object.freeze([...new Set(values.map((value) => value.logicalEdgeKey))].sort(CompareText)),
      mergedDummyCount: values.length
    }));
    void groupKey;
  }

  const nodes = [...realNodes, ...mergedNodes]
    .sort((left, right) => left.rank - right.rank || CompareText(left.key, right.key));
  const nodeByKey = new Map(nodes.map((node) => [node.key, node]));
  const segments = proper.segments.map((segment) => Object.freeze({
    ...segment,
    sourceKey: replacement.get(segment.sourceKey) || segment.sourceKey,
    targetKey: replacement.get(segment.targetKey) || segment.targetKey
  }));
  const chains = proper.chains.map((chain) => Object.freeze({
    ...chain,
    dummyKeys: Object.freeze(chain.dummyKeys.map((key) => replacement.get(key) || key))
  }));
  const layers = proper.layers.map((layer) => {
    const seen = new Set();
    const layerNodes = [];
    for (const node of layer.nodes) {
      const key = replacement.get(node.key) || node.key;
      if (seen.has(key)) continue;
      seen.add(key);
      layerNodes.push(nodeByKey.get(key));
    }
    return Object.freeze({ rank: layer.rank, nodes: Object.freeze(layerNodes) });
  });
  const crossingLayers = crossing.layers.map((layer) => {
    const seen = new Set();
    const nodeKeys = [];
    for (const originalKey of layer.nodeKeys) {
      const key = replacement.get(originalKey) || originalKey;
      if (seen.has(key)) continue;
      seen.add(key);
      nodeKeys.push(key);
    }
    return Object.freeze({ rank: layer.rank, nodeKeys: Object.freeze(nodeKeys) });
  });

  return Object.freeze({
    proper: Object.freeze({
      ...proper,
      nodes: Object.freeze(nodes),
      layers: Object.freeze(layers),
      segments: Object.freeze(segments),
      chains: Object.freeze(chains)
    }),
    crossing: Object.freeze({ ...crossing, layers: Object.freeze(crossingLayers) }),
    metrics: Object.freeze({
      before: proper.nodes.length - realNodes.length,
      after: mergedNodes.length,
      merged: proper.nodes.length - realNodes.length - mergedNodes.length
    })
  });
}

function CompareText(left, right) {
  return String(left ?? "").localeCompare(String(right ?? ""));
}
