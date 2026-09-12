import { getPhysicalNetKey } from "./layoutTopology.js";
import { getConnectionPoint, getPort } from "./nodeGeometry.js";

const MAX_ROW_GAP_DEMANDS = 64;
const MAX_BOUNDARY_CLUSTER_ENDPOINT_SAMPLES = 32;
// Keep each physical channel bounded. Overflow demands retain diagnostics but
// do not create unbounded placement expansion or a fake duplicate lane.
export const MAX_CHANNEL_LANES_PER_SCOPE = 256;
// Placement must reserve a useful outer band without allowing a large mapped
// graph to turn every physical net into a full-height canvas expansion. The
// router still reports overflow so unmet capacity is diagnosable.
export const MAX_PLACEMENT_OUTER_LANES = 8;

export const DEFAULT_ROUTING_GEOMETRY = Object.freeze({
  nodeClearance: 8,
  targetApproachClearance: 9,
  minimumVisibleTargetCornerGap: 16,
  portEscapeLength: 24,
  outerLaneClearance: 24,
  laneReusePadding: 4,
  wireLanePitch: 24,
  // Collapsed groups can expose dozens of boundary ports.  Their escape
  // rails need a separately named, bounded pitch so consuming the rail does
  // not force every full-net channel to use the normal readability pitch.
  groupBoundaryLanePitch: 8,
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
    groupBoundaryLanePitch: positiveOr(
      values.groupBoundaryLanePitch,
      DEFAULT_ROUTING_GEOMETRY.groupBoundaryLanePitch
    ),
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
  const boundaryClusterCounts = new Map();
  const levelBounds = getLevelBounds(positionedNodes, levels);
  const channelById = new Map();
  const demandsByBoundary = new Map();
  for (const demand of demands) {
    for (const boundaryId of demand.traversedBoundaryIds) {
      const entries = demandsByBoundary.get(boundaryId) || [];
      entries.push(demand);
      demandsByBoundary.set(boundaryId, entries);
    }
  }

  // A long edge can need a horizontal corridor between two nodes that share
  // one spatial column.  Model those gaps as bounded channels before the
  // inter-layer pass so placement can enlarge only the affected suffix.  The
  // demand index is keyed by intermediate level; it avoids rescanning all
  // physical nets for every adjacent node pair.
  const rowGapChannels = buildRowGapChannels(
    demands,
    positionedNodes,
    levels,
    routingGeometry,
    nodeById
  );
  for (const channel of rowGapChannels) {
    channels.push(channel);
    channelById.set(channel.id, channel);
    for (const assigned of channel.assignments || []) {
      boundaryClusterCounts.set(
        assigned.boundaryClusterKey,
        (boundaryClusterCounts.get(assigned.boundaryClusterKey) || 0) + 1
      );
      const entries = allocationByNet.get(assigned.netGroupKey) || [];
      entries.push({
        channelId: channel.id,
        laneIndex: assigned.laneIndex,
        coordinate: assigned.coordinate,
        intervalStart: assigned.intervalStart,
        intervalEnd: assigned.intervalEnd,
        boundaryClusterKey: assigned.boundaryClusterKey,
        sourceEscapeSide: assigned.sourceEscapeSide,
        targetEscapeSides: assigned.targetEscapeSides,
        sourceEscapeInterval: assigned.sourceEscapeInterval,
        targetEscapeRanges: assigned.targetEscapeRanges
      });
      allocationByNet.set(assigned.netGroupKey, entries);
    }
  }

  for (const boundaryId of uniqueSorted(demands.flatMap((demand) => demand.traversedBoundaryIds))) {
    const [leftLevel, rightLevel] = parseBoundaryId(boundaryId);
    const channelDemands = (demandsByBoundary.get(boundaryId) || [])
      .map((demand) => createInterLayerDemand(
        demand,
        leftLevel,
        rightLevel,
        nodeById,
        layoutIntent,
        edgeById,
        routingGeometry
      ))
      .toSorted(compareChannelDemands);
    const allocation = allocateIntervalLanes(
      channelDemands,
      routingGeometry.laneReusePadding,
      routingGeometry.wireLanePitch,
      MAX_CHANNEL_LANES_PER_SCOPE
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
      overflowCount: allocation.overflowCount,
      lanes: allocation.lanes,
      assignments: allocation.assignments,
      demandKeys: channelDemands.map((demand) => demand.netGroupKey),
      demands: channelDemands
    };
    channels.push(channel);
    channelById.set(channel.id, channel);
    for (const assigned of allocation.assignments) {
      boundaryClusterCounts.set(
        assigned.boundaryClusterKey,
        (boundaryClusterCounts.get(assigned.boundaryClusterKey) || 0) + 1
      );
      const entries = allocationByNet.get(assigned.netGroupKey) || [];
      entries.push({
        channelId: channel.id,
        laneIndex: assigned.laneIndex,
        coordinate: assigned.coordinate,
        intervalStart: assigned.intervalStart,
        intervalEnd: assigned.intervalEnd,
        boundaryClusterKey: assigned.boundaryClusterKey,
        sourceEscapeSide: assigned.sourceEscapeSide,
        targetEscapeSides: assigned.targetEscapeSides,
        sourceEscapeInterval: assigned.sourceEscapeInterval,
        targetEscapeRanges: assigned.targetEscapeRanges
      });
      allocationByNet.set(assigned.netGroupKey, entries);
    }
  }

  const outerDemands = demands.filter((demand) => demand.maximumLevel - demand.minimumLevel > 1)
    .map((demand) => createOuterDemand(
      demand,
      nodeById,
      layoutIntent,
      edgeById,
      routingGeometry
    ))
    .toSorted(compareChannelDemands);
  for (const kind of ["outer-top", "outer-bottom"]) {
    const channelDemands = outerDemands.map((demand) => ({ ...demand, channelId: kind }));
    const rawAllocation = allocateIntervalLanes(
      channelDemands,
      routingGeometry.laneReusePadding,
      routingGeometry.wireLanePitch,
      MAX_CHANNEL_LANES_PER_SCOPE
    );
    const allocation = assignOuterLaneCoordinates(
      rawAllocation,
      kind,
      positionedNodes,
      routingGeometry
    );
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
      overflowCount: allocation.overflowCount,
      lanes: allocation.lanes,
      assignments: allocation.assignments,
      demandKeys: channelDemands.map((demand) => demand.netGroupKey),
      demands: channelDemands
    };
    channels.push(channel);
    for (const assigned of allocation.assignments) {
      boundaryClusterCounts.set(
        assigned.boundaryClusterKey,
        (boundaryClusterCounts.get(assigned.boundaryClusterKey) || 0) + 1
      );
      const entries = allocationByNet.get(assigned.netGroupKey) || [];
      entries.push({
        channelId: kind,
        laneIndex: assigned.laneIndex,
        coordinate: assigned.coordinate,
        intervalStart: assigned.intervalStart,
        intervalEnd: assigned.intervalEnd,
        boundaryClusterKey: assigned.boundaryClusterKey,
        sourceEscapeSide: assigned.sourceEscapeSide,
        targetEscapeSides: assigned.targetEscapeSides,
        sourceEscapeInterval: assigned.sourceEscapeInterval,
        targetEscapeRanges: assigned.targetEscapeRanges
      });
      allocationByNet.set(assigned.netGroupKey, entries);
    }
  }

  const expansion = {
    interLayer: channels
      .filter((channel) => channel.kind === "inter-layer")
      .reduce((sum, channel) => sum + channel.expansion, 0),
    rowGap: channels
      .filter((channel) => channel.kind === "row-gap")
      .reduce((sum, channel) => sum + channel.expansion, 0),
    outerTop: channels.find((channel) => channel.kind === "outer-top")?.expansion || 0,
    outerBottom: channels.find((channel) => channel.kind === "outer-bottom")?.expansion || 0
  };
  // Ordinary layered graphs do not expose collapsed boundary corridors. Do
  // not pay the per-assignment metadata reduction cost for them; the route
  // planner still has its channel allocations and can opt into the richer
  // cluster contract when a group endpoint is present.
  const hasGroupBoundary = positionedNodes.some((node) => node.kind === "group");
  const boundaryClusters = hasGroupBoundary
    ? buildBoundaryClusterMetadata(channels)
    : [];
  const publicChannels = channels.map((channel) => {
    // Inter-layer and outer allocations are consumed through allocationByNet
    // and the compact cluster summary.  Retaining every spread assignment on
    // the returned channel would keep all endpointRefs alive for large
    // fanout graphs and dominate heap usage.  Row-gap channels stay detailed
    // because their bounded assignment list is used by placement diagnostics.
    if (channel.kind === "row-gap") return channel;
    const { assignments, ...compactChannel } = channel;
    return compactChannel;
  });
  return {
    netDemands: demands,
    channels: publicChannels.toSorted((left, right) => left.id.localeCompare(right.id)),
    allocationByNet,
    nodeEscapeReservations: [],
    expansion,
    diagnostics: channels.flatMap((channel) => [
      ...(channel.expansion > 0 ? [{
        code: "channel-capacity-expansion",
        channelId: channel.id,
        currentSpan: channel.currentSpan,
        requiredSpan: channel.requiredSpan,
        laneCount: channel.laneCount
      }] : []),
      ...(channel.overflowCount > 0 ? [{
        code: "channel-capacity-overflow",
        channelId: channel.id,
        laneCount: channel.laneCount,
        overflowCount: channel.overflowCount,
        maximumLanes: MAX_CHANNEL_LANES_PER_SCOPE
      }] : [])
    ]),
    metrics: {
      physicalNetCount: demands.length,
      channelCount: channels.length,
      allocatedLaneCount: channels.reduce((sum, channel) => sum + channel.laneCount, 0),
      expandedChannelCount: channels.filter((channel) => channel.expansion > 0).length,
      overflowChannelCount: channels.filter((channel) => channel.overflowCount > 0).length,
      overflowDemandCount: channels.reduce((sum, channel) => sum + (channel.overflowCount || 0), 0),
      boundaryClusterCount: boundaryClusterCounts.size,
      maximumBoundaryClusterDemand: Math.max(0, ...boundaryClusterCounts.values()),
      topWireHeadroom: options.topWireHeadroom || null
    },
    boundaryClusterCounts,
    boundaryClusters,
    boundaryClusterByKey: new Map(boundaryClusters.map((cluster) => [
      cluster.boundaryClusterKey,
      cluster
    ])),
    routingGeometry,
    channelById: new Map(publicChannels.map((channel) => [channel.id, channel]))
  };
}

function assignOuterLaneCoordinates(allocation, kind, positionedNodes, routingGeometry) {
  let nodeTop = 0;
  let nodeBottom = 0;
  for (const node of positionedNodes) {
    const top = Number(node.y) || 0;
    nodeTop = Math.min(nodeTop, top);
    nodeBottom = Math.max(nodeBottom, top + (Number(node.height) || 0));
  }
  const clearance = Number(routingGeometry.outerLaneClearance) ||
    DEFAULT_ROUTING_GEOMETRY.outerLaneClearance;
  const pitch = Number(routingGeometry.wireLanePitch) ||
    DEFAULT_ROUTING_GEOMETRY.wireLanePitch;
  const top = kind === "outer-top";
  const base = top ? nodeTop - clearance : nodeBottom + clearance;
  const direction = top ? -1 : 1;
  return {
    ...allocation,
    assignments: allocation.assignments.map((assignment) => assignment.capacityOverflow
      ? assignment
      : {
        ...assignment,
        coordinate: base + direction * Number(assignment.laneIndex) * pitch
      })
  };
}

/**
 * Preserve the stable geometry contract for each allocated boundary cluster.
 * The router may consume this metadata later, but collecting it here already
 * prevents callers from reconstructing ownership by rescanning all edges.
 */
function buildBoundaryClusterMetadata(channels = []) {
  const clusters = new Map();
  for (const channel of channels) {
    for (const assignment of channel.assignments || []) {
      const key = assignment.boundaryClusterKey;
      if (!key) continue;
      const current = clusters.get(key) || {
        boundaryClusterKey: key,
        channelIds: new Set(),
        physicalNetKeys: new Set(),
        sourceNodeIds: new Set(),
        targetNodeIds: new Set(),
        targetNodeCount: 0,
        sourceEscapeSides: new Set(),
        targetEscapeSides: new Set(),
        sourceEscapeMinimum: Infinity,
        sourceEscapeMaximum: -Infinity,
        targetEscapeMinimum: Infinity,
        targetEscapeMaximum: -Infinity,
        demandCount: 0,
        laneIndices: [],
        coordinateMinimum: Infinity,
        coordinateMaximum: -Infinity,
        intervalStart: Infinity,
        intervalEnd: -Infinity
      };
      current.channelIds.add(String(channel.id));
      current.physicalNetKeys.add(String(assignment.netGroupKey ?? ""));
      if (assignment.sourceNodeId !== undefined) current.sourceNodeIds.add(String(assignment.sourceNodeId));
      current.targetNodeCount = Math.max(
        current.targetNodeCount,
        Array.isArray(assignment.endpointRefs) ? assignment.endpointRefs.length : 0
      );
      for (const ref of (assignment.endpointRefs || []).slice(0, MAX_BOUNDARY_CLUSTER_ENDPOINT_SAMPLES)) {
        if (current.targetNodeIds.size >= MAX_BOUNDARY_CLUSTER_ENDPOINT_SAMPLES) break;
        if (ref?.nodeId !== undefined) current.targetNodeIds.add(String(ref.nodeId));
      }
      if (assignment.sourceEscapeSide) current.sourceEscapeSides.add(String(assignment.sourceEscapeSide));
      for (const side of assignment.targetEscapeSides || []) current.targetEscapeSides.add(String(side));
      if (assignment.sourceEscapeInterval) {
        const interval = normalizeEscapeInterval(assignment.sourceEscapeInterval);
        if (interval.minimum !== null) current.sourceEscapeMinimum = Math.min(
          current.sourceEscapeMinimum,
          interval.minimum
        );
        if (interval.maximum !== null) current.sourceEscapeMaximum = Math.max(
          current.sourceEscapeMaximum,
          interval.maximum
        );
      }
      for (const interval of assignment.targetEscapeRanges || []) {
        const normalized = normalizeEscapeInterval(interval);
        if (normalized.minimum !== null) current.targetEscapeMinimum = Math.min(
          current.targetEscapeMinimum,
          normalized.minimum
        );
        if (normalized.maximum !== null) current.targetEscapeMaximum = Math.max(
          current.targetEscapeMaximum,
          normalized.maximum
        );
      }
      current.demandCount += 1;
      if (Number.isFinite(Number(assignment.laneIndex))) current.laneIndices.push(Number(assignment.laneIndex));
      if (Number.isFinite(Number(assignment.coordinate))) {
        current.coordinateMinimum = Math.min(current.coordinateMinimum, Number(assignment.coordinate));
        current.coordinateMaximum = Math.max(current.coordinateMaximum, Number(assignment.coordinate));
      }
      if (Number.isFinite(Number(assignment.intervalStart))) {
        current.intervalStart = Math.min(current.intervalStart, Number(assignment.intervalStart));
      }
      if (Number.isFinite(Number(assignment.intervalEnd))) {
        current.intervalEnd = Math.max(current.intervalEnd, Number(assignment.intervalEnd));
      }
      clusters.set(key, current);
    }
  }
  return [...clusters.values()]
    .map((cluster) => ({
      boundaryClusterKey: cluster.boundaryClusterKey,
      channelIds: [...cluster.channelIds].sort(),
      physicalNetKeys: [...cluster.physicalNetKeys].sort(),
      sourceNodeIds: [...cluster.sourceNodeIds].sort(),
      targetNodeIds: [...cluster.targetNodeIds].sort(),
      targetNodeCount: cluster.targetNodeCount,
      sourceEscapeSides: [...cluster.sourceEscapeSides].sort(),
      targetEscapeSides: [...cluster.targetEscapeSides].sort(),
      sourceEscapeMinimum: Number.isFinite(cluster.sourceEscapeMinimum)
        ? cluster.sourceEscapeMinimum
        : null,
      sourceEscapeMaximum: Number.isFinite(cluster.sourceEscapeMaximum)
        ? cluster.sourceEscapeMaximum
        : null,
      targetEscapeMinimum: Number.isFinite(cluster.targetEscapeMinimum)
        ? cluster.targetEscapeMinimum
        : null,
      targetEscapeMaximum: Number.isFinite(cluster.targetEscapeMaximum)
        ? cluster.targetEscapeMaximum
        : null,
      demandCount: cluster.demandCount,
      laneIndices: [...new Set(cluster.laneIndices)].sort((left, right) => left - right),
      coordinateMinimum: Number.isFinite(cluster.coordinateMinimum) ? cluster.coordinateMinimum : null,
      coordinateMaximum: Number.isFinite(cluster.coordinateMaximum) ? cluster.coordinateMaximum : null,
      intervalStart: Number.isFinite(cluster.intervalStart) ? cluster.intervalStart : null,
      intervalEnd: Number.isFinite(cluster.intervalEnd) ? cluster.intervalEnd : null
    }))
    .sort((left, right) => left.boundaryClusterKey.localeCompare(right.boundaryClusterKey));
}

/** Apply only the horizontal expansion that belongs to a real core-column gap. */
export function applyRoutingCapacityExpansion(positionedNodes = [], capacityPlan = {}) {
  const rowGapExpansions = (capacityPlan.channels || [])
    .filter((channel) => channel.kind === "row-gap" && channel.expansion > 0)
    .map((channel) => ({
      ...channel,
      level: Number(channel.level),
      upperNodeId: String(channel.upperNodeId),
      lowerNodeId: String(channel.lowerNodeId)
    }))
    .filter((channel) => Number.isFinite(channel.level))
    .filter((channel) => isGroupBoundaryCorridor(positionedNodes, channel))
    .sort((left, right) => left.level - right.level ||
      Number(left.lowerY) - Number(right.lowerY) ||
      left.id.localeCompare(right.id));
  const expandedRowGaps = applyRowGapSuffixExpansions(positionedNodes, rowGapExpansions);
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
    expandedChannels: expansions.length,
    rowGapExpansion: rowGapExpansions.reduce((sum, channel) => sum + channel.expansion, 0),
    expandedRowGaps
  };
}

/** Stable interval coloring with min-heaps for active and reusable lanes. */
export function allocateIntervalLanes(
  demands = [],
  padding = 4,
  pitch = 24,
  maximumLanes = Infinity
) {
  const laneLimit = Number.isFinite(Number(maximumLanes)) && Number(maximumLanes) > 0
    ? Math.floor(Number(maximumLanes))
    : Infinity;
  const ordered = [...demands].sort(compareChannelDemands);
  const active = new MinHeap((left, right) =>
    left.intervalEnd - right.intervalEnd || left.laneIndex - right.laneIndex);
  const free = new MinHeap((left, right) => left - right);
  const lanes = [];
  const assignments = [];
  let overflowCount = 0;
  for (const demand of ordered) {
    while (active.size > 0 && active.peek().intervalEnd + 2 * padding <= demand.intervalStart) {
      free.push(active.pop().laneIndex);
    }
    const laneIndex = free.size > 0 ? free.pop() : lanes.length;
    if (laneIndex >= laneLimit) {
      overflowCount += 1;
      assignments.push({
        ...demand,
        laneIndex: null,
        coordinate: null,
        capacityOverflow: true
      });
      continue;
    }
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
  return { laneCount: lanes.length, lanes, assignments, overflowCount };
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

/**
 * Convert physical long-net demand into bounded placement headroom. The
 * caller-provided value remains a lower bound for compatibility; demand above
 * the fixed cap is reported rather than expanding placement without bound.
 */
export function computeTopWireHeadroom(
  longLaneDemand,
  routingGeometry,
  margin,
  requestedTopWireSpace = 80
) {
  const demand = Math.max(0, Math.floor(Number(longLaneDemand) || 0));
  const reservedLaneCount = Math.min(demand, MAX_PLACEMENT_OUTER_LANES);
  const requested = Math.max(0, Number(requestedTopWireSpace) || 0);
  const capacityHeadroom = (Number(margin) || 0) +
    requiredOuterBand(reservedLaneCount, routingGeometry);
  return {
    topWireSpace: Math.max(requested, capacityHeadroom),
    longLaneDemand: demand,
    reservedLaneCount,
    overflowLaneCount: Math.max(0, demand - reservedLaneCount),
    capacityHeadroom
  };
}

/**
 * Build horizontal corridors between adjacent nodes in one spatial column.
 * Only physical nets that cross the level and whose x projection reaches the
 * pair are indexed, so the pass remains bounded by traversed net boundaries
 * instead of doing an all-pairs graph scan.
 */
function buildRowGapChannels(demands, positionedNodes, levels, routingGeometry, nodeById) {
  const nodesByLevel = new Map();
  for (const node of positionedNodes) {
    const level = finiteLevel(levels, node.id, Number(node.level) || 0);
    const entries = nodesByLevel.get(level) || [];
    entries.push(node);
    nodesByLevel.set(level, entries);
  }
  const demandsByLevel = new Map();
  for (const demand of demands) {
    for (let level = demand.minimumLevel + 1; level < demand.maximumLevel; level += 1) {
      const entries = demandsByLevel.get(level) || [];
      entries.push(demand);
      demandsByLevel.set(level, entries);
    }
  }

  const channels = [];
  for (const [level, levelNodes] of [...nodesByLevel.entries()].sort(([left], [right]) => left - right)) {
    const crossingDemands = demandsByLevel.get(level) || [];
    if (crossingDemands.length === 0) continue;
    const orderedNodes = [...levelNodes].sort((left, right) =>
      Number(left.y) - Number(right.y) || String(left.id).localeCompare(String(right.id)));
    for (let index = 0; index + 1 < orderedNodes.length; index += 1) {
      const upper = orderedNodes[index];
      const lower = orderedNodes[index + 1];
      const currentSpan = Math.max(0,
        Number(lower.y) - (Number(upper.y) + Number(upper.height)));
      // Existing wide gaps already provide a legal one-lane corridor. Do not
      // eagerly enumerate every long net through them: in a collapsed graph
      // that would turn one row into thousands of artificial lanes and make
      // capacity planning quadratic in practice.
      if (currentSpan >= requiredRowGap(1, routingGeometry)) continue;
      const gapRange = getRowGapXRange(upper, lower, routingGeometry.nodeClearance);
      if (!gapRange) continue;
      const channelDemands = crossingDemands
        .filter((demand) => {
          const span = demandXSpan(demand, nodeById);
          return span && rangesOverlap(span[0], span[1], gapRange[0], gapRange[1]);
        })
        .map((demand) => createRowGapDemand(
          demand,
          upper,
          lower,
          gapRange,
          nodeById,
          routingGeometry
        ))
        .toSorted(compareChannelDemands);
      if (channelDemands.length === 0) continue;
      if (channelDemands.length > MAX_ROW_GAP_DEMANDS) continue;
      const allocation = allocateIntervalLanes(
        channelDemands,
        routingGeometry.laneReusePadding,
        routingGeometry.wireLanePitch,
        MAX_CHANNEL_LANES_PER_SCOPE
      );
      const requiredSpan = requiredRowGap(allocation.laneCount, routingGeometry);
      const channel = {
        id: `row-gap:${String(level)}:${String(upper.id)}->${String(lower.id)}`,
        kind: "row-gap",
        axis: "y",
        scopeKey: `level:${String(level)}|${String(upper.id)}->${String(lower.id)}`,
        level,
        upperNodeId: upper.id,
        lowerNodeId: lower.id,
        upperY: Number(upper.y) || 0,
        lowerY: Number(lower.y) || 0,
        currentSpan,
        requiredSpan,
        expansion: Math.max(0, requiredSpan - currentSpan),
        laneCount: allocation.laneCount,
        overflowCount: allocation.overflowCount,
        lanes: allocation.lanes,
        demandKeys: channelDemands.map((demand) => demand.netGroupKey),
        demands: channelDemands,
        assignments: allocation.assignments
      };
      channels.push(channel);
    }
  }
  return channels;
}

function createRowGapDemand(demand, upper, lower, gapRange, nodeById, routingGeometry) {
  const ranges = demandXRange(demand, nodeById);
  const [intervalStart, intervalEnd] = ranges.reduce((result, range) => [
    Math.min(result[0], range[0]),
    Math.max(result[1], range[1])
  ], [Infinity, -Infinity]);
  const source = nodeById.get(demand.sourceNodeId);
  const sourceEscapeSide = getPortSide(source, demand.sourcePortRef.pin, "source");
  const targetEscapeSides = [...new Set(demand.targetPortRefs.map((ref) =>
    getPortSide(nodeById.get(ref.nodeId), ref.pin, "target")))].sort();
  const includeEscapeIntervals = source?.kind === "group" ||
    demand.targetPortRefs.some((ref) => nodeById.get(ref.nodeId)?.kind === "group");
  return {
    channelId: `row-gap:${String(upper.level ?? "")}:${String(upper.id)}->${String(lower.id)}`,
    netGroupKey: demand.netGroupKey,
    intervalStart: Number.isFinite(intervalStart) ? intervalStart : gapRange[0],
    intervalEnd: Number.isFinite(intervalEnd) ? intervalEnd : gapRange[1],
    preferredCoordinate: (Number(upper.y) || 0) + (Number(upper.height) || 0),
    priorityClass: demand.fanout > 1 ? 1 : 0,
    endpointRefs: demand.targetPortRefs,
    sourceNodeId: demand.sourceNodeId,
    sourceEscapeSide,
    targetEscapeSides,
    sourceEscapeInterval: includeEscapeIntervals
      ? getEscapeInterval(source, sourceEscapeSide, routingGeometry)
      : null,
    targetEscapeRanges: includeEscapeIntervals
      ? summarizeTargetEscapeRanges(demand.targetPortRefs, nodeById, routingGeometry)
      : [],
    boundaryClusterKey: `row-gap:${String(upper.level ?? "")}:${String(upper.id)}->${String(lower.id)}`
  };
}

function demandXRange(demand, nodeById) {
  const ranges = [];
  const source = nodeById.get(demand.sourceNodeId);
  if (source) ranges.push([Number(source.x) || 0, (Number(source.x) || 0) + (Number(source.width) || 0)]);
  for (const ref of demand.targetPortRefs || []) {
    const target = nodeById.get(ref.nodeId);
    if (target) ranges.push([Number(target.x) || 0, (Number(target.x) || 0) + (Number(target.width) || 0)]);
  }
  return ranges;
}

function demandXSpan(demand, nodeById) {
  const ranges = demandXRange(demand, nodeById);
  if (ranges.length === 0) return null;
  return ranges.reduce((result, range) => [
    Math.min(result[0], range[0]),
    Math.max(result[1], range[1])
  ], [Infinity, -Infinity]);
}

function getRowGapXRange(upper, lower, clearance) {
  const left = Math.max(Number(upper.x) || 0, Number(lower.x) || 0) - clearance;
  const right = Math.min(
    (Number(upper.x) || 0) + (Number(upper.width) || 0),
    (Number(lower.x) || 0) + (Number(lower.width) || 0)
  ) + clearance;
  return right > left ? [left, right] : null;
}

function rangesOverlap(leftStart, leftEnd, rightStart, rightEnd) {
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

function isGroupBoundaryCorridor(nodes, channel) {
  const upper = nodes.find((node) => String(node.id) === channel.upperNodeId);
  const lower = nodes.find((node) => String(node.id) === channel.lowerNodeId);
  return upper?.kind === "group" || lower?.kind === "group";
}

function applyRowGapSuffixExpansions(nodes, channels) {
  if (channels.length === 0 || nodes.length === 0) return 0;
  const byLevel = new Map();
  const indexByNodeId = new Map();
  for (const node of nodes) {
    const level = Number(node.level) || 0;
    const entries = byLevel.get(level) || [];
    entries.push(node);
    byLevel.set(level, entries);
  }
  for (const entries of byLevel.values()) {
    entries.sort((left, right) => Number(left.y) - Number(right.y) ||
      String(left.id).localeCompare(String(right.id)));
    entries.forEach((node, index) => indexByNodeId.set(String(node.id), { level: Number(node.level) || 0, index }));
  }
  const eventsByLevel = new Map();
  let applied = 0;
  for (const channel of channels) {
    const location = indexByNodeId.get(channel.lowerNodeId);
    if (!location || location.level !== channel.level) continue;
    const events = eventsByLevel.get(location.level) || new Map();
    events.set(location.index, (events.get(location.index) || 0) + channel.expansion);
    eventsByLevel.set(location.level, events);
    applied += 1;
  }
  for (const [level, entries] of byLevel) {
    const events = eventsByLevel.get(level);
    if (!events) continue;
    let suffixShift = 0;
    for (let index = 0; index < entries.length; index += 1) {
      suffixShift += events.get(index) || 0;
      if (suffixShift > 0) entries[index].y += suffixShift;
    }
  }
  return applied;
}

function createInterLayerDemand(
  demand,
  leftLevel,
  rightLevel,
  nodeById,
  layoutIntent,
  edgeById,
  routingGeometry
) {
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
  const sourceEscapeSide = getPortSide(sourceNode, demand.sourcePortRef.pin, "source");
  const targetEscapeSides = [...new Set(edges.map(({ nodeId, pin }) =>
    getPortSide(nodeById.get(nodeId), pin, "target")))].sort();
  const includeEscapeIntervals = sourceNode?.kind === "group" ||
    edges.some(({ nodeId }) => nodeById.get(nodeId)?.kind === "group");
  const sourceEscapeInterval = includeEscapeIntervals
    ? getEscapeInterval(sourceNode, sourceEscapeSide, routingGeometry)
    : null;
  const targetEscapeRanges = includeEscapeIntervals
    ? summarizeTargetEscapeRanges(edges, nodeById, routingGeometry)
    : [];
  return {
    channelId: `inter-layer:${leftLevel}->${rightLevel}`,
    netGroupKey: demand.netGroupKey,
    intervalStart,
    intervalEnd,
    preferredCoordinate,
    priorityClass: intent.fanout > 1 && intent.isPrimary ? 1 : intent.fanout > 1 ? 2 : 0,
    endpointRefs: demand.targetPortRefs,
    sourceNodeId: demand.sourceNodeId,
    sourceEscapeSide,
    targetEscapeSides,
    sourceEscapeInterval,
    targetEscapeRanges,
    boundaryClusterKey: `${String(leftLevel)}->${String(rightLevel)}|${demand.sourceNodeId}|${sourceEscapeSide}|${targetEscapeSides.join(",")}`
  };
}

function createOuterDemand(demand, nodeById, layoutIntent, edgeById, routingGeometry) {
  const xs = [];
  const source = nodeById.get(demand.sourceNodeId);
  if (source) xs.push(source.x, source.x + source.width);
  for (const ref of demand.targetPortRefs) {
    const target = nodeById.get(ref.nodeId);
    if (target) xs.push(target.x, target.x + target.width);
  }
  const intent = layoutIntent?.getEdge(edgeById.get(demand.targetPortRefs[0]?.edgeId)) || {};
  const sourceEscapeSide = getPortSide(source, demand.sourcePortRef.pin, "source");
  const targetEscapeSides = [...new Set(demand.targetPortRefs.map((ref) =>
    getPortSide(nodeById.get(ref.nodeId), ref.pin, "target")))].sort();
  const includeEscapeIntervals = source?.kind === "group" ||
    demand.targetPortRefs.some((ref) => nodeById.get(ref.nodeId)?.kind === "group");
  const sourceEscapeInterval = includeEscapeIntervals
    ? getEscapeInterval(source, sourceEscapeSide, routingGeometry)
    : null;
  const targetEscapeRanges = includeEscapeIntervals
    ? summarizeTargetEscapeRanges(demand.targetPortRefs, nodeById, routingGeometry)
    : [];
  return {
    channelId: "outer",
    netGroupKey: demand.netGroupKey,
    ...toInterval(xs),
    preferredCoordinate: 0,
    priorityClass: intent.fanout > 1 ? 1 : 0,
    endpointRefs: demand.targetPortRefs,
    sourceNodeId: demand.sourceNodeId,
    sourceEscapeSide,
    targetEscapeSides,
    sourceEscapeInterval,
    targetEscapeRanges,
    boundaryClusterKey: `outer|${demand.sourceNodeId}|${sourceEscapeSide}|${targetEscapeSides.join(",")}`
  };
}

function getPortSide(node, pin, role) {
  return (node ? getPort(node, pin, role)?.side : null) ||
    (role === "source" ? "right" : "left");
}

function getEscapeInterval(node, side, routingGeometry = DEFAULT_ROUTING_GEOMETRY) {
  if (side !== "left" && side !== "right") return null;
  if (!node || !Number.isFinite(Number(node.x)) || !Number.isFinite(Number(node.width))) return null;
  const boundary = side === "left" ? Number(node.x) : Number(node.x) + Number(node.width);
  const direction = side === "left" ? -1 : 1;
  const clearance = Number(routingGeometry.nodeClearance) || DEFAULT_ROUTING_GEOMETRY.nodeClearance;
  const maximum = (Number(routingGeometry.portEscapeLength) || DEFAULT_ROUTING_GEOMETRY.portEscapeLength) +
    MAX_PLACEMENT_OUTER_LANES * (Number(routingGeometry.groupBoundaryLanePitch) ||
      DEFAULT_ROUTING_GEOMETRY.groupBoundaryLanePitch);
  return {
    side,
    minimum: Math.min(boundary + direction * clearance, boundary + direction * maximum),
    maximum: Math.max(boundary + direction * clearance, boundary + direction * maximum)
  };
}

function normalizeEscapeInterval(interval) {
  if (!interval) return { side: null, minimum: null, maximum: null };
  return {
    side: interval.side || null,
    minimum: Number.isFinite(Number(interval.minimum)) ? Number(interval.minimum) : null,
    maximum: Number.isFinite(Number(interval.maximum)) ? Number(interval.maximum) : null
  };
}

function summarizeTargetEscapeRanges(refs = [], nodeById, routingGeometry) {
  const ranges = new Map();
  for (const ref of refs || []) {
    const node = nodeById.get(ref?.nodeId);
    // The fine-grained escape contract is consumed only at collapsed group
    // boundaries.  Do not allocate interval objects for a large fanout of
    // ordinary cells; their existing endpoint metadata remains sufficient.
    if (node?.kind !== "group") continue;
    const side = getPortSide(node, ref?.pin, "target");
    const interval = getEscapeInterval(node, side, routingGeometry);
    const normalized = normalizeEscapeInterval(interval);
    if (!normalized.side || normalized.minimum === null || normalized.maximum === null) continue;
    const current = ranges.get(normalized.side) || {
      side: normalized.side,
      minimum: normalized.minimum,
      maximum: normalized.maximum
    };
    current.minimum = Math.min(current.minimum, normalized.minimum);
    current.maximum = Math.max(current.maximum, normalized.maximum);
    ranges.set(normalized.side, current);
  }
  return [...ranges.values()].sort((left, right) => left.side.localeCompare(right.side));
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
