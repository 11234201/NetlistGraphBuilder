import { compareEdgesByLayoutPriority } from "./layoutIntent.js";
import { getNetGroupKey } from "./layoutTopology.js";

export function planSimpleRouting(graph, levels, layoutIntent) {
  const edges = new Map();
  const channelLanes = new Map();
  const channelLaneByFanout = new Map();
  const fanoutCounts = new Map();
  for (const edge of graph.edges) {
    const key = getNetGroupKey(edge);
    fanoutCounts.set(key, (fanoutCounts.get(key) || 0) + 1);
  }

  const longSourceLanes = new Map();
  const longSourceLaneByFanout = new Map();
  const longTargetLanes = new Map();
  let longLaneCount = 0;
  let maxSideLanes = 1;

  const orderedEdges = graph.edges.toSorted((left, right) =>
    compareEdgesByLayoutPriority(left, right, layoutIntent));
  for (const edge of orderedEdges) {
    const sourceLevel = levels.get(edge.source) || 0;
    const targetLevel = levels.get(edge.target) || sourceLevel + 1;
    const levelDistance = targetLevel - sourceLevel;

    if (levelDistance <= 1) {
      const key = `${sourceLevel}->${targetLevel}`;
      const fanoutKey = getNetGroupKey(edge);
      let lane = channelLaneByFanout.get(fanoutKey);
      if (lane === undefined || fanoutCounts.get(fanoutKey) === 1) {
        lane = channelLanes.get(key) || 0;
        channelLanes.set(key, lane + 1);
        if (fanoutCounts.get(fanoutKey) > 1) channelLaneByFanout.set(fanoutKey, lane);
      }
      maxSideLanes = Math.max(maxSideLanes, lane + 1);
      edges.set(edge.id, { kind: "channel", lane });
      continue;
    }

    const sourceKey = `source:${sourceLevel}`;
    const targetKey = `target:${targetLevel}`;
    const intent = layoutIntent.getEdge(edge);
    let sourceLane = intent?.fanout > 1
      ? longSourceLaneByFanout.get(intent.groupKey)
      : undefined;
    if (sourceLane === undefined) {
      sourceLane = longSourceLanes.get(sourceKey) || 0;
      if (intent?.fanout > 1) longSourceLaneByFanout.set(intent.groupKey, sourceLane);
    }
    const targetLane = longTargetLanes.get(targetKey) || 0;
    longSourceLanes.set(sourceKey, Math.max(longSourceLanes.get(sourceKey) || 0, sourceLane + 1));
    longTargetLanes.set(targetKey, targetLane + 1);
    maxSideLanes = Math.max(maxSideLanes, sourceLane + 1, targetLane + 1);
    edges.set(edge.id, {
      kind: "long",
      topLane: longLaneCount,
      sourceLane,
      targetLane
    });
    longLaneCount += 1;
  }

  return { edges, longLaneCount, maxSideLanes };
}
