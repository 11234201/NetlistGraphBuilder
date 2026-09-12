import { getPhysicalNetKey } from "./layoutTopology.js";
import { getConnectionPoint } from "./nodeGeometry.js";

export const DEFAULT_ROUTING_GEOMETRY = Object.freeze({
  nodeClearance: 8,
  targetApproachClearance: 9,
  minimumVisibleTargetCornerGap: 16,
  portEscapeLength: 24,
  outerLaneClearance: 24,
  laneReusePadding: 4,
  wireLanePitch: 24,
  minimumEndpointInset: 2,
  maximumEndpointInset: 24,
  reverseEndpointInset: 12
});

/**
 * Normalize all geometry values used by the capacity planner at the provider
 * boundary. The router and placement code can pass the returned immutable
 * object without introducing private clamps or fallback scales.
 */
export function normalizeRoutingGeometry(spacing = {}, overrides = {}) {
  const values = { ...DEFAULT_ROUTING_GEOMETRY, ...spacing, ...overrides };
  const routingGeometry = {
    nodeClearance: positiveOr(values.nodeClearance, DEFAULT_ROUTING_GEOMETRY.nodeClearance),
    targetApproachClearance: positiveOr(
      values.targetApproachClearance,
      DEFAULT_ROUTING_GEOMETRY.targetApproachClearance
    ),
    minimumVisibleTargetCornerGap: positiveOr(
      values.minimumVisibleTargetCornerGap,
      DEFAULT_ROUTING_GEOMETRY.minimumVisibleTargetCornerGap
    ),
    portEscapeLength: positiveOr(values.portEscapeLength, DEFAULT_ROUTING_GEOMETRY.portEscapeLength),
    outerLaneClearance: positiveOr(values.outerLaneClearance, DEFAULT_ROUTING_GEOMETRY.outerLaneClearance),
    laneReusePadding: nonNegativeOr(values.laneReusePadding, DEFAULT_ROUTING_GEOMETRY.laneReusePadding),
    wireLanePitch: positiveOr(values.wireLanePitch, DEFAULT_ROUTING_GEOMETRY.wireLanePitch),
    minimumEndpointInset: positiveOr(
      values.minimumEndpointInset,
      DEFAULT_ROUTING_GEOMETRY.minimumEndpointInset
    ),
    maximumEndpointInset: positiveOr(
      values.maximumEndpointInset,
      DEFAULT_ROUTING_GEOMETRY.maximumEndpointInset
    ),
    reverseEndpointInset: positiveOr(
      values.reverseEndpointInset,
      DEFAULT_ROUTING_GEOMETRY.reverseEndpointInset
    )
  };
  return Object.freeze(routingGeometry);
}

/**
 * Build one demand per physical net. A physical net is deliberately separate
 * from logical edges: all sinks sharing a driver/net pair share a trunk lane.
 */
export function buildPhysicalNetDemands(graph, levels = new Map(), layoutIntent = null) {
  const nodeById = new Map((graph?.nodes || []).map((node) => [node.id, node]));
  const groups = new Map();
  for (const edge of graph?.edges || []) {
    const key = getPhysicalNetKey(edge);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(edge);
  }

  const demands = [];
  for (const [netGroupKey, edges] of groups) {
    const sortedEdges = [...edges].sort(compareEdges);
    const sourceNodeId = String(sortedEdges[0]?.source ?? "");
    const source = nodeById.get(sortedEdges[0]?.source);
    const sourceLevel = finiteLevel(levels, sortedEdges[0]?.source);
    const targetPortRefs = sortedEdges.map((edge) => ({
      edgeId: String(edge.id ?? ""),
      nodeId: String(edge.target ?? ""),
      pin: String(edge.targetPin ?? "")
    }));
    const targetLevels = [...new Set(sortedEdges.map((edge) =>
      finiteLevel(levels, edge.target, sourceLevel + 1)))].sort((left, right) => left - right);
    const minimumLevel = Math.min(sourceLevel, ...targetLevels);
    const maximumLevel = Math.max(sourceLevel, ...targetLevels);
    const traversedBoundaryIds = [];
    for (let level = minimumLevel; level < maximumLevel; level += 1) {
      traversedBoundaryIds.push(`level:${level}->${level + 1}`);
    }
    const firstIntent = layoutIntent?.getEdge(sortedEdges[0]) || {};
    demands.push({
      netGroupKey,
      sourceNodeId,
      sourcePortRef: {
        nodeId: sourceNodeId,
        pin: String(sortedEdges[0]?.sourcePin ?? "")
      },
      targetPortRefs,
      sourceLevel,
      targetLevels,
      minimumLevel,
      maximumLevel,
      traversedBoundaryIds,
      fanout: sortedEdges.length,
      stableRank: `${String(source?.id ?? sourceNodeId)}\u0000${String(sortedEdges[0]?.net ?? "")}\u0000${
        String(firstIntent.rank ?? 0)
      }`,
      net: String(sortedEdges[0]?.net ?? sortedEdges[0]?.label ?? "")
    });
  }
  return demands.toSorted(compareDemands);
}

/**
 * Generate geometry-aware channels after placement. It is intentionally a
 * bounded pass: every physical net contributes at most once per boundary and
 * the interval allocator is O(D log D) per channel.
 */
export function buildRoutingCapacityPlan(
  graph,
  levels,
  positionedNodes = [],
  layoutIntent = null,
  options = {}
) {
  const routingGeometry = normalizeRoutingGeometry(
    options.spacing || {},
    options.routingGeometry || {}
  );
  const demands = buildPhysicalNetDemands(graph, levels, layoutIntent);
  const edgeById = new Map((graph?.edges || []).map((edge) => [String(edge.id ?? ""), edge]));
  const nodeById = new Map(positionedNodes.map((node) => [node.id, node]));
  const channels = [];
  const allocationByNet = new Map();
  const levelBounds = getLevelBounds(positionedNodes, levels);
  const channelById = new Map();

  for (const boundaryId of uniqueSorted(demands.flatMap((demand) => demand.traversedBoundaryIds))) {
    const [leftLevel, rightLevel] = parseBoundaryId(boundaryId);
    const channelDemands = demands
      .filter((demand) => demand.traversedBoundaryIds.includes(boundaryId))
      .map((demand) => createInterLayerDemand(
        demand,
        leftLevel,
        rightLevel,
        nodeById,
        layoutIntent,
        edgeById
      ))
      .toSorted(compareChannelDemands);
    const allocation = allocateIntervalLanes(
      channelDemands,
      routingGeometry.laneReusePadding
    );
    const currentSpan = getInterLayerSpan(levelBounds, leftLevel, rightLevel);
    const requiredSpan = currentSpan === null
      ? 0
      : requiredInterLayerGap(allocation.laneCount, routingGeometry);
    const channel = {
      id: `inter-layer:${leftLevel}->${rightLevel}`,
      kind: "inter-layer",
      axis: "x",
      scopeKey: boundaryId,
      currentSpan,
      requiredSpan,
      expansion: currentSpan === null ? 0 : Math.max(0, requiredSpan - currentSpan),
      laneCount: allocation.laneCount,
      lanes: allocation.lanes,
      demandKeys: channelDemands.map((demand) => demand.netGroupKey),
      demands: channelDemands
    };
    channels.push(channel);
    channelById.set(channel.id, channel);
    for (const assigned of allocation.assignments) {
      const entries = allocationByNet.get(assigned.netGroupKey) || [];
      entries.push({
        channelId: channel.id,
        laneIndex: assigned.laneIndex,
        coordinate: assigned.coordinate,
        intervalStart: assigned.intervalStart,
        intervalEnd: assigned.intervalEnd
      });
      allocationByNet.set(assigned.netGroupKey, entries);
    }
  }

  const outerDemands = demands.filter((demand) => demand.maximumLevel - demand.minimumLevel > 1)
    .map((demand) => createOuterDemand(demand, nodeById, layoutIntent, edgeById))
    .toSorted(compareChannelDemands);
  for (const kind of ["outer-top", "outer-bottom"]) {
    const channelDemands = outerDemands.map((demand) => ({ ...demand, channelId: kind }));
    const allocation = allocateIntervalLanes(channelDemands, routingGeometry.laneReusePadding);
    const currentSpan = Number(options[`${kind}Span`]) || 0;
    const requiredSpan = requiredOuterBand(allocation.laneCount, routingGeometry);
    const channel = {
      id: kind,
      kind,
      axis: "y",
      scopeKey: kind,
      currentSpan,
      requiredSpan,
      expansion: Math.max(0, requiredSpan - currentSpan),
      laneCount: allocation.laneCount,
      lanes: allocation.lanes,
      demandKeys: channelDemands.map((demand) => demand.netGroupKey),
      demands: channelDemands
    };
    channels.push(channel);
    for (const assigned of allocation.assignments) {
      const entries = allocationByNet.get(assigned.netGroupKey) || [];
      entries.push({
        channelId: kind,
        laneIndex: assigned.laneIndex,
        coordinate: assigned.coordinate,
        intervalStart: assigned.intervalStart,
        intervalEnd: assigned.intervalEnd
      });
      allocationByNet.set(assigned.netGroupKey, entries);
    }
  }

  const expansion = {
    interLayer: channels
      .filter((channel) => channel.kind === "inter-layer")
      .reduce((sum, channel) => sum + channel.expansion, 0),
    outerTop: channels.find((channel) => channel.kind === "outer-top")?.expansion || 0,
    outerBottom: channels.find((channel) => channel.kind === "outer-bottom")?.expansion || 0
  };
  return {
    netDemands: demands,
    channels: channels.toSorted((left, right) => left.id.localeCompare(right.id)),
    allocationByNet,
    nodeEscapeReservations: [],
    expansion,
    diagnostics: channels.filter((channel) => channel.expansion > 0).map((channel) => ({
      code: "channel-capacity-expansion",
      channelId: channel.id,
      currentSpan: channel.currentSpan,
      requiredSpan: channel.requiredSpan,
      laneCount: channel.laneCount
    })),
    metrics: {
      physicalNetCount: demands.length,
      channelCount: channels.length,
      allocatedLaneCount: channels.reduce((sum, channel) => sum + channel.laneCount, 0),
      expandedChannelCount: channels.filter((channel) => channel.expansion > 0).length
    },
    routingGeometry,
    channelById
  };
}

/** Apply only the horizontal expansion that belongs to a real core-column gap. */
export function applyRoutingCapacityExpansion(positionedNodes = [], capacityPlan = {}) {
  const expansions = (capacityPlan.channels || [])
    .filter((channel) => channel.kind === "inter-layer" && channel.expansion > 0)
    .map((channel) => {
      const [leftLevel, rightLevel] = parseBoundaryId(channel.scopeKey);
      return { leftLevel, rightLevel, expansion: channel.expansion };
    })
    .sort((left, right) => left.rightLevel - right.rightLevel || left.leftLevel - right.leftLevel);
  let cumulative = 0;
  const shiftByLevel = new Map();
  let expansionIndex = 0;
  for (const node of [...positionedNodes].sort((left, right) =>
    (Number(left.level) || 0) - (Number(right.level) || 0))) {
    const level = Number(node.level) || 0;
    while (expansionIndex < expansions.length && expansions[expansionIndex].rightLevel <= level) {
      cumulative += expansions[expansionIndex].expansion;
      expansionIndex += 1;
    }
    shiftByLevel.set(level, cumulative);
  }
  for (const node of positionedNodes) {
    cumulative = shiftByLevel.get(Number(node.level) || 0) || 0;
    if (cumulative > 0) {
      node.x += cumulative;
      node.spatialColumn = Number(node.level) || 0;
    }
  }
  return {
    expansion: maxValue(shiftByLevel.values()),
    expandedChannels: expansions.length
  };
}

/** Stable interval coloring with min-heaps for active and reusable lanes. */
export function allocateIntervalLanes(demands = [], padding = 4, pitch = 24) {
  const ordered = [...demands].sort(compareChannelDemands);
  const active = new MinHeap((left, right) =>
    left.intervalEnd - right.intervalEnd || left.laneIndex - right.laneIndex);
  const free = new MinHeap((left, right) => left - right);
  const lanes = [];
  const assignments = [];
  for (const demand of ordered) {
    while (active.size > 0 && active.peek().intervalEnd + 2 * padding <= demand.intervalStart) {
      free.push(active.pop().laneIndex);
    }
    const laneIndex = free.size > 0 ? free.pop() : lanes.length;
    if (laneIndex === lanes.length) lanes.push({ laneIndex, demandKeys: [] });
    lanes[laneIndex].demandKeys.push(demand.netGroupKey);
    const assigned = {
      ...demand,
      laneIndex,
      coordinate: Number.isFinite(demand.preferredCoordinate)
        ? demand.preferredCoordinate + laneIndex * pitch
        : laneIndex * pitch
    };
    assignments.push(assigned);
    active.push(assigned);
  }
  return { laneCount: lanes.length, lanes, assignments };
}

export function requiredRowGap(laneCount, geometry) {
  return laneCount <= 0 ? 0 : 2 * geometry.nodeClearance + (laneCount - 1) * geometry.wireLanePitch;
}

export function requiredInterLayerGap(laneCount, geometry) {
  const escape = Math.max(
    geometry.portEscapeLength,
    geometry.nodeClearance + geometry.minimumVisibleTargetCornerGap
  );
  return laneCount <= 0 ? 0 : 2 * escape + (laneCount - 1) * geometry.wireLanePitch;
}

export function requiredOuterBand(laneCount, geometry) {
  return laneCount <= 0 ? 0 : geometry.nodeClearance + (laneCount - 1) * geometry.wireLanePitch;
}

function createInterLayerDemand(demand, leftLevel, rightLevel, nodeById, layoutIntent, edgeById) {
  const edges = demand.targetPortRefs.map((ref) => ({
    ...ref,
    edge: edgeById.get(ref.edgeId)
  }));
  const ys = [];
  const sourceNode = nodeById.get(demand.sourceNodeId);
  if (sourceNode) {
    ys.push(getConnectionPoint(sourceNode, demand.sourcePortRef.pin, "source").y);
  }
  for (const ref of edges) {
    const targetNode = nodeById.get(ref.nodeId);
    if (targetNode) ys.push(getConnectionPoint(targetNode, ref.pin, "target").y);
  }
  const [intervalStart, intervalEnd] = minMax(ys);
  const preferredCoordinate = (intervalStart + intervalEnd) / 2;
  const intent = layoutIntent?.getEdge(edges[0]?.edge) || {};
  return {
    channelId: `inter-layer:${leftLevel}->${rightLevel}`,
    netGroupKey: demand.netGroupKey,
    intervalStart,
    intervalEnd,
    preferredCoordinate,
    priorityClass: intent.fanout > 1 && intent.isPrimary ? 1 : intent.fanout > 1 ? 2 : 0,
    endpointRefs: demand.targetPortRefs,
    sourceNodeId: demand.sourceNodeId
  };
}

function createOuterDemand(demand, nodeById, layoutIntent, edgeById) {
  const xs = [];
  const source = nodeById.get(demand.sourceNodeId);
  if (source) xs.push(source.x, source.x + source.width);
  for (const ref of demand.targetPortRefs) {
    const target = nodeById.get(ref.nodeId);
    if (target) xs.push(target.x, target.x + target.width);
  }
  const intent = layoutIntent?.getEdge(edgeById.get(demand.targetPortRefs[0]?.edgeId)) || {};
  return {
    channelId: "outer",
    netGroupKey: demand.netGroupKey,
    ...toInterval(xs),
    preferredCoordinate: 0,
    priorityClass: intent.fanout > 1 ? 1 : 0,
    endpointRefs: demand.targetPortRefs,
    sourceNodeId: demand.sourceNodeId
  };
}

function minMax(values) {
  if (values.length === 0) return [0, 0];
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const value of values) {
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  return [minimum, maximum];
}

function toInterval(values) {
  const [intervalStart, intervalEnd] = minMax(values);
  return { intervalStart, intervalEnd };
}

function maxValue(values) {
  let maximum = 0;
  for (const value of values) maximum = Math.max(maximum, Number(value) || 0);
  return maximum;
}

function getLevelBounds(nodes, levels) {
  const bounds = new Map();
  for (const node of nodes) {
    const level = finiteLevel(levels, node.id, Number(node.level) || 0);
    const current = bounds.get(level) || {
      level,
      minimumX: Infinity,
      maximumX: -Infinity,
      coreMinimumX: Infinity,
      coreMaximumX: -Infinity,
      hasCore: false
    };
    current.minimumX = Math.min(current.minimumX, Number(node.x) || 0);
    current.maximumX = Math.max(current.maximumX, (Number(node.x) || 0) + (Number(node.width) || 0));
    if (node.kind === "cell" || node.kind === "assign" || node.kind === "hub") {
      current.coreMinimumX = Math.min(current.coreMinimumX, Number(node.x) || 0);
      current.coreMaximumX = Math.max(current.coreMaximumX, (Number(node.x) || 0) + (Number(node.width) || 0));
      current.hasCore = true;
    }
    bounds.set(level, current);
  }
  return bounds;
}

function getInterLayerSpan(bounds, leftLevel, rightLevel) {
  const left = bounds.get(leftLevel);
  const right = bounds.get(rightLevel);
  if (!left?.hasCore || !right?.hasCore) return null;
  return Math.max(0, right.coreMinimumX - left.coreMaximumX);
}

function parseBoundaryId(value) {
  const match = String(value).match(/^level:(-?\d+)->(-?\d+)$/);
  return match ? [Number(match[1]), Number(match[2])] : [0, 1];
}

function finiteLevel(levels, id, fallback = 0) {
  const value = Number(levels?.get(id));
  return Number.isFinite(value) ? value : fallback;
}

function compareEdges(left, right) {
  return String(left?.target ?? "").localeCompare(String(right?.target ?? "")) ||
    String(left?.targetPin ?? "").localeCompare(String(right?.targetPin ?? "")) ||
    String(left?.id ?? "").localeCompare(String(right?.id ?? ""));
}

function compareDemands(left, right) {
  return left.minimumLevel - right.minimumLevel ||
    left.maximumLevel - right.maximumLevel ||
    left.stableRank.localeCompare(right.stableRank) ||
    left.netGroupKey.localeCompare(right.netGroupKey);
}

function compareChannelDemands(left, right) {
  return left.intervalStart - right.intervalStart ||
    left.intervalEnd - right.intervalEnd ||
    left.priorityClass - right.priorityClass ||
    left.netGroupKey.localeCompare(right.netGroupKey);
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => String(left).localeCompare(String(right)));
}

function positiveOr(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function nonNegativeOr(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

class MinHeap {
  constructor(compare) {
    this.items = [];
    this.compare = compare;
  }

  get size() {
    return this.items.length;
  }

  peek() {
    return this.items[0];
  }

  push(value) {
    this.items.push(value);
    this.bubbleUp(this.items.length - 1);
  }

  pop() {
    if (this.items.length === 0) return undefined;
    const result = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0) {
      this.items[0] = last;
      this.bubbleDown(0);
    }
    return result;
  }

  bubbleUp(index) {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(this.items[parent], this.items[index]) <= 0) break;
      [this.items[parent], this.items[index]] = [this.items[index], this.items[parent]];
      index = parent;
    }
  }

  bubbleDown(index) {
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < this.items.length && this.compare(this.items[left], this.items[smallest]) < 0) {
        smallest = left;
      }
      if (right < this.items.length && this.compare(this.items[right], this.items[smallest]) < 0) {
        smallest = right;
      }
      if (smallest === index) break;
      [this.items[index], this.items[smallest]] = [this.items[smallest], this.items[index]];
      index = smallest;
    }
  }
}
