export const DEFAULT_PROPER_LAYERING_POLICY = Object.freeze({ maxDummyNodes: 100000 });

/** Split oriented logical edges into adjacent-rank segments. */
export function BuildProperLayering(model, orientation, ranking, policy = {}) {
  const maxDummyNodes = ClampInteger(policy.maxDummyNodes, 0, 500000, DEFAULT_PROPER_LAYERING_POLICY.maxDummyNodes);
  const nodes = model.nodes.map((node) => Object.freeze({ ...node, rank: ranking.ranks.get(node.key) ?? 0, dummy: false }));
  const dummyNodes = [];
  const segments = [];
  const chains = [];
  const diagnostics = [];
  const demandsByBoundary = new Map();

  for (const edge of orientation.edges) {
    if (edge.ignoredForLayering) {
      chains.push(Object.freeze({ edgeKey: edge.key, dummyKeys: Object.freeze([]), segmentKeys: Object.freeze([]) }));
      continue;
    }
    const sourceRank = ranking.ranks.get(edge.layoutSourceKey);
    const targetRank = ranking.ranks.get(edge.layoutTargetKey);
    const span = targetRank - sourceRank;
    if (span < edge.minimumLength || span < 1) {
      diagnostics.push(Object.freeze({ code: "native-layered-invalid-rank-span", edgeKey: edge.key, span }));
      continue;
    }
    const required = Math.max(0, span - 1);
    if (dummyNodes.length + required > maxDummyNodes) {
      diagnostics.push(Object.freeze({ code: "native-layered-dummy-cap-exceeded", edgeKey: edge.key, required }));
      continue;
    }
    const dummyKeys = [];
    const segmentKeys = [];
    let previousKey = edge.layoutSourceKey;
    for (let rank = sourceRank + 1; rank < targetRank; rank += 1) {
      const key = DummyKey(edge, rank);
      dummyKeys.push(key);
      dummyNodes.push(Object.freeze({
        key,
        kind: "native-layered-dummy",
        rank,
        width: 0,
        height: 0,
        dummy: true,
        logicalEdgeKey: edge.key,
        physicalNetKey: edge.physicalNetKey
      }));
      const segment = MakeSegment(edge, previousKey, key, rank - 1, segmentKeys.length);
      segments.push(segment);
      segmentKeys.push(segment.key);
      previousKey = key;
    }
    const finalSegment = MakeSegment(edge, previousKey, edge.layoutTargetKey, targetRank - 1, segmentKeys.length);
    segments.push(finalSegment);
    segmentKeys.push(finalSegment.key);
    chains.push(Object.freeze({
      edgeKey: edge.key,
      dummyKeys: Object.freeze(dummyKeys),
      segmentKeys: Object.freeze(segmentKeys)
    }));
    for (let boundary = sourceRank; boundary < targetRank; boundary += 1) {
      const boundaryDemands = demandsByBoundary.get(boundary) || new Map();
      if (!boundaryDemands.has(edge.physicalNetKey)) {
        boundaryDemands.set(edge.physicalNetKey, Object.freeze({
          key: `${edge.physicalNetKey}\u0000${boundary}`,
          physicalNetKey: edge.physicalNetKey,
          boundary,
          sourceRank,
          targetRank
        }));
      }
      demandsByBoundary.set(boundary, boundaryDemands);
    }
  }

  const allNodes = [...nodes, ...dummyNodes].sort(CompareLayerNodes);
  const layers = [];
  for (const node of allNodes) {
    let layer = layers.at(-1);
    if (!layer || layer.rank !== node.rank) {
      layer = { rank: node.rank, nodes: [] };
      layers.push(layer);
    }
    layer.nodes.push(node);
  }
  const boundaryDemands = [...demandsByBoundary.entries()]
    .sort(([left], [right]) => left - right)
    .map(([boundary, demands]) => Object.freeze({
      boundary,
      demands: Object.freeze([...demands.values()].sort((left, right) => CompareText(left.key, right.key)))
    }));
  return Object.freeze({
    nodes: Object.freeze(allNodes),
    layers: Object.freeze(layers.map((layer) => Object.freeze({ ...layer, nodes: Object.freeze(layer.nodes) }))),
    segments: Object.freeze(segments.sort((left, right) => CompareText(left.key, right.key))),
    chains: Object.freeze(chains.sort((left, right) => CompareText(left.edgeKey, right.edgeKey))),
    boundaryDemands: Object.freeze(boundaryDemands),
    diagnostics: Object.freeze(diagnostics)
  });
}

export function JoinProperLayering(proper) {
  return Object.freeze(proper.chains.map((chain) => Object.freeze({
    edgeKey: chain.edgeKey,
    segmentKeys: chain.segmentKeys
  })));
}

function MakeSegment(edge, sourceKey, targetKey, boundary, index) {
  return Object.freeze({
    key: `segment:${edge.key}:${index}`,
    logicalEdgeKey: edge.key,
    physicalNetKey: edge.physicalNetKey,
    sourceKey,
    targetKey,
    boundary
  });
}

function DummyKey(edge, rank) {
  return ["dummy", edge.physicalNetKey, edge.layoutSourceKey, edge.layoutTargetKey, edge.key, rank].join(":");
}

function CompareLayerNodes(left, right) {
  return left.rank - right.rank || CompareText(left.key, right.key);
}

function CompareText(left, right) {
  return String(left).localeCompare(String(right));
}

function ClampInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.floor(number))) : fallback;
}
