import { compareEdgesByLayoutPriority } from "./layoutIntent.js";
import { getNetGroupKey } from "./layoutTopology.js";
import { buildPhysicalNetDemands } from "./channelCapacity.js";

export function planSimpleRouting(graph, levels, layoutIntent) {
  const edges = new Map();
  const channelLanes = new Map();
  const channelLaneByFanout = new Map();
  const channelSourceLaneByFanout = new Map();
  const fanoutCounts = new Map();
  for (const edge of graph.edges) {
    const key = getNetGroupKey(edge);
    fanoutCounts.set(key, (fanoutCounts.get(key) || 0) + 1);
  }

  const longSourceLanes = new Map();
  const longSourceLaneByFanout = new Map();
  const longTargetLanes = new Map();
  const physicalLongLanes = new Map();
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
      let sourceLane = channelSourceLaneByFanout.get(fanoutKey);
      if (sourceLane === undefined) {
        sourceLane = nextNodeLane(longSourceLanes, `source-node:${String(edge.source ?? "")}`);
        if (fanoutCounts.get(fanoutKey) > 1) {
          channelSourceLaneByFanout.set(fanoutKey, sourceLane);
        }
      }
      const targetLane = nextNodeLane(longTargetLanes, `target-node:${String(edge.target ?? "")}`);
      edges.set(edge.id, {
        kind: "channel",
        lane,
        sourceLane,
        targetLane,
        sourcePin: edge.sourcePin,
        targetPin: edge.targetPin
      });
      continue;
    }

    // Escape lanes are consumed at a concrete boundary node.  Keying these
    // counters by level made a large collapsed level assign hundreds of
    // unrelated nets to the same physical escape lane (or produce lane
    // numbers so large that the router could not safely consume them).  A
    // node-local counter preserves sharing for one physical fanout while
    // giving independent group boundary ports distinct bounded lanes.
    const sourceKey = `source-node:${String(edge.source ?? "")}`;
    const targetKey = `target-node:${String(edge.target ?? "")}`;
    const intent = layoutIntent.getEdge(edge);
    const netKey = getNetGroupKey(edge);
    let sourceLane = intent?.fanout > 1
      ? longSourceLaneByFanout.get(intent.groupKey)
      : undefined;
    if (sourceLane === undefined) {
      sourceLane = nextNodeLane(longSourceLanes, sourceKey);
      if (intent?.fanout > 1) longSourceLaneByFanout.set(intent.groupKey, sourceLane);
    }
    const targetLane = nextNodeLane(longTargetLanes, targetKey);
    maxSideLanes = Math.max(maxSideLanes, sourceLane + 1, targetLane + 1);
    let topLane = physicalLongLanes.get(netKey);
    if (topLane === undefined) {
      topLane = longLaneCount;
      physicalLongLanes.set(netKey, topLane);
      longLaneCount += 1;
    }
    edges.set(edge.id, {
      kind: "long",
      topLane,
      sourceLane,
      targetLane,
      sourcePin: edge.sourcePin,
      targetPin: edge.targetPin
    });
  }

  const netDemands = buildPhysicalNetDemands(graph, levels, layoutIntent);
  return {
    edges,
    longLaneCount,
    maxSideLanes,
    netDemands,
    physicalNetCount: netDemands.length
  };
}

function nextNodeLane(lanes, key) {
  const lane = lanes.get(key) || 0;
  lanes.set(key, lane + 1);
  return lane;
}
