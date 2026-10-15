import {
  BuildAnchorChains,
  BuildBoundaryRoutingGraph
} from "./routing_graph.js";
import { BuildHyperedgeSegments } from "./hyperedge_segments.js";
import { BuildSegmentDependencies, BuildTapOverlapConstraints } from "./segment_dependencies.js";
import { Deduplicate } from "./segment_conflicts.js";
import {
  BreakNonCriticalCycles,
  BreakResidualCycles
} from "./segment_cycle_breaking.js";
import { SplitCriticalCycles } from "./segment_splitting.js";
import { AssignRoutingSlots } from "./slot_assignment.js";
import { DEFAULT_PROJECTION_POLICY, ProjectRankCoordinates } from "./boundary_projection.js";
import { BuildHopPolyline } from "./route_geometry.js";
import { JoinChainPolylines, RestoreSemanticDirection } from "./long_edge_joining.js";
import { CommitPhysicalNets } from "./net_commit_gate.js";
import { BuildExceptionalRoute } from "./exceptional_routes.js";
import { buildNodePorts, getConnectionPoint } from "../../../../src/layout/nodeGeometry.js";
import { createNodeSpatialIndex } from "../../../../src/layout/spatialIndex.js";

/**
 * NLR orchestration.
 *
 * The phase split is deliberate: ordering depends on final y and port
 * coordinates but not on final x, so segments, dependencies, splitting and slot
 * numbering all run before any x coordinate exists. Only then does slot count
 * own the boundary width and bend points materialize.
 */

export const DEFAULT_ROUTER_POLICY = Object.freeze({
  margin: DEFAULT_PROJECTION_POLICY.margin,
  edgeEdgeSpacing: 12,
  edgeNodeSpacing: DEFAULT_PROJECTION_POLICY.edgeNodeSpacing,
  nodeNodeSpacing: DEFAULT_PROJECTION_POLICY.nodeNodeSpacing,
  // Candidate volume is the dominant cost of planning: every dependency is
  // revisited by dedupe, cycle breaking and slot assignment. The constraints
  // that keep wires apart come from the exact tap-overlap pass, so the
  // preference candidates here only buy crossing reduction and stay tightly
  // bounded.
  maximumActiveCandidates: 32,
  maximumBucketCandidates: 128
});

export function RouteNativeOrthogonal({ graph, model, orientation, proper, structure, options = {} }) {
  const startedAt = Now();
  const policy = NormalizePolicy(options);
  const phases = {};
  const diagnostics = [];

  const placementPhase = Measure(() => BuildPlacedNodes(graph, structure));
  phases.placement = placementPhase.elapsedMs;
  const placedByKey = placementPhase.value.placedByKey;
  const publicEdgeById = placementPhase.value.publicEdgeById;

  const graphPhase = Measure(() => BuildBoundaryRoutingGraph(
    proper,
    orientation,
    BuildAnchorChains(proper, orientation, placedByKey)
  ));
  phases.routingGraph = graphPhase.elapsedMs;
  const boundaryGraph = graphPhase.value;
  diagnostics.push(...boundaryGraph.diagnostics);

  const segmentPhase = Measure(() => BuildHyperedgeSegments(boundaryGraph));
  phases.segments = segmentPhase.elapsedMs;
  const segmentModel = segmentPhase.value;
  const segmentsByBoundary = new Map(segmentModel.boundaries.map((entry) => [entry.boundary, entry.segments]));

  const planPhase = Measure(() => PlanBoundaries({
    boundaryGraph,
    segmentsByBoundary,
    policy,
    diagnostics
  }));
  phases.planning = planPhase.elapsedMs;
  const planning = planPhase.value;
  const plans = planning.plans;

  const projectionPhase = Measure(() => ProjectRankCoordinates(
    BuildRankWidths(structure),
    new Map([...plans.entries()].map(([boundary, plan]) => [boundary, plan.slotCount])),
    policy
  ));
  phases.projection = projectionPhase.elapsedMs;
  const projection = projectionPhase.value;

  for (const node of placedByKey.values()) {
    node.x = projection.rankX.get(node.rank) ?? node.x;
  }

  const geometryPhase = Measure(() => BuildGeometry({
    boundaryGraph,
    plans,
    projection,
    proper,
    orientation,
    placedByKey,
    publicEdgeById,
    policy
  }));
  phases.geometry = geometryPhase.elapsedMs;
  const geometry = geometryPhase.value;

  const positionedNodes = [...placedByKey.values()]
    .filter((node) => !node.dummy)
    .map((node) => Object.freeze({
      ...(node.publicSource || {}),
      id: node.key,
      x: node.x,
      y: node.y,
      level: node.rank,
      width: node.width,
      height: node.height,
      ports: node.ports || []
    }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const nodeIndex = createNodeSpatialIndex(positionedNodes);
  const height = Math.max(
    0,
    ...positionedNodes.map((node) => node.y + node.height),
    ...geometry.points.map((point) => point.y)
  ) + policy.margin;
  const width = Math.max(projection.width, ...geometry.points.map((point) => point.x)) + policy.margin;

  const commitPhase = Measure(() => CommitPhysicalNets({
    nets: model.physicalNets,
    routedEdges: geometry.routedEdges,
    positionedNodes,
    width,
    height,
    nodeIndex
  }));
  phases.commit = commitPhase.elapsedMs;
  const commit = commitPhase.value;

  const metrics = Object.freeze({
    elapsedMs: Math.round((Now() - startedAt) * 1000) / 1000,
    phases: Object.freeze(phases),
    segmentCount: segmentModel.segmentCount,
    dependencyCount: planning.dependencyCount,
    criticalDependencyCount: planning.criticalDependencyCount,
    maximumActiveCandidates: planning.maximumActiveCandidates,
    splitCount: planning.splitCount,
    slotCount: planning.slotCount,
    topologicalSlotCount: planning.topologicalSlotCount,
    separatedCount: planning.separatedCount,
    violatedConstraintCount: planning.violatedConstraintCount,
    remainingOverlaps: planning.remainingOverlaps,
    straightSegmentCount: planning.straightCount,
    truncated: planning.truncated,
    exceptionalEdgeCount: geometry.exceptionalEdgeCount,
    missingTrunkCount: geometry.missingTrunkCount,
    committedNetCount: commit.metrics.committedNetCount,
    rejectedNetCount: commit.metrics.rejectedNetCount
  });

  return Object.freeze({
    nodes: Object.freeze(positionedNodes),
    edges: commit.edges,
    wireRoutes: commit.wireRoutes,
    width,
    height,
    diagnostics: Object.freeze([...diagnostics, ...commit.diagnostics]),
    metrics
  });
}

function PlanBoundaries({ boundaryGraph, segmentsByBoundary, policy, diagnostics }) {
  const plans = new Map();
  let dependencyCount = 0;
  let criticalDependencyCount = 0;
  let maximumActiveCandidates = 0;
  let splitCount = 0;
  let slotCount = 0;
  let topologicalSlotCount = 0;
  let separatedCount = 0;
  let violatedConstraintCount = 0;
  let straightCount = 0;
  let remainingOverlaps = 0;
  let truncated = false;

  for (const boundary of boundaryGraph.boundaries) {
    const segments = segmentsByBoundary.get(boundary.boundary) || [];
    if (segments.length === 0) {
      plans.set(boundary.boundary, Object.freeze({
        segments: Object.freeze([]),
        slots: new Map(),
        slotCount: 0
      }));
      continue;
    }
    const dependencies = BuildSegmentDependencies(segments, {
      edgeEdgeSpacing: policy.edgeEdgeSpacing,
      boundary: boundary.boundary,
      maximumActiveCandidates: policy.maximumActiveCandidates,
      maximumBucketCandidates: policy.maximumBucketCandidates
    });
    truncated = truncated || dependencies.metrics.truncated;
    maximumActiveCandidates = Math.max(maximumActiveCandidates, dependencies.metrics.maximumActiveCandidates);
    // The exact pass runs twice on purpose: the oracle's merge walk is an
    // approximation and misses near-coincident tap pairs, and the segments a
    // split creates are new segments that no earlier pass has seen.
    const exact = BuildTapOverlapConstraints(segments, {
      maximumBucketCandidates: policy.maximumBucketCandidates
    });
    const combined = Deduplicate([
      ...dependencies.dependencies,
      ...exact.dependencies
    ]);
    truncated = truncated || exact.truncated;
    const split = SplitCriticalCycles(segments, combined, dependencies.thresholds, {
      maximumSplitsPerBoundary: policy.maximumSplitsPerBoundary
    });
    splitCount += split.splitCount;
    diagnostics.push(...split.diagnostics);
    const splitExact = BuildTapOverlapConstraints(split.segments, {
      maximumBucketCandidates: policy.maximumBucketCandidates
    });
    const broken = BreakNonCriticalCycles(Deduplicate([
      ...split.dependencies,
      ...splitExact.dependencies
    ]));
    diagnostics.push(...broken.diagnostics);
    // Splitting adds segments after the split phase looked at cycles, so the
    // graph is re-checked here; nothing downstream tolerates a cycle.
    const residual = BreakResidualCycles(broken.dependencies);
    diagnostics.push(...residual.diagnostics);
    const slots = AssignRoutingSlots(split.segments, residual.dependencies);
    if (slots.violatedConstraintCount > 0) {
      diagnostics.push(Object.freeze({
        code: "native-router-hard-constraint-violated",
        boundary: boundary.boundary,
        count: slots.violatedConstraintCount,
        constraints: slots.violatedConstraints
      }));
    }
    dependencyCount += broken.dependencies.length;
    criticalDependencyCount += dependencies.metrics.criticalDependencyCount;
    slotCount += slots.slotCount;
    topologicalSlotCount += slots.topologicalSlotCount;
    separatedCount += slots.separatedCount;
    violatedConstraintCount += slots.violatedConstraintCount;
    straightCount += slots.straightCount;
    remainingOverlaps += slots.remainingOverlaps;
    plans.set(boundary.boundary, Object.freeze({
      segments: split.segments,
      slots: slots.slots,
      slotCount: slots.slotCount,
      thresholds: dependencies.thresholds
    }));
  }

  return Object.freeze({
    plans,
    dependencyCount,
    criticalDependencyCount,
    maximumActiveCandidates,
    splitCount,
    slotCount,
    topologicalSlotCount,
    separatedCount,
    violatedConstraintCount,
    straightCount,
    remainingOverlaps,
    truncated
  });
}

function BuildGeometry({ boundaryGraph, plans, projection, proper, orientation, placedByKey, publicEdgeById, policy }) {
  const chains = BuildAnchorChains(proper, orientation, placedByKey);
  const pointByHopKey = new Map();
  for (const chain of chains.values()) {
    for (let index = 0; index < chain.points.length - 1; index += 1) {
      pointByHopKey.set(`hop:${chain.edgeKey}:${index}`, Object.freeze({
        left: chain.points[index],
        right: chain.points[index + 1]
      }));
    }
  }

  const polylinesByEdge = new Map();
  let missingTrunkCount = 0;
  for (const boundary of boundaryGraph.boundaries) {
    const plan = plans.get(boundary.boundary);
    if (!plan) continue;
    const startPos = projection.startPosByBoundary.get(boundary.boundary) ?? 0;
    const trunkByNet = BuildTrunkMap(plan, startPos, policy);
    for (const tap of boundary.taps) {
      const points = pointByHopKey.get(tap.hopKey);
      if (!points) continue;
      const trunk = trunkByNet.get(tap.physicalNetKey);
      if (!trunk) {
        missingTrunkCount += 1;
        continue;
      }
      const polyline = BuildHopPolyline({
        leftPoint: points.left,
        rightPoint: points.right,
        trunkX: trunk.trunkX,
        bridgeX: trunk.bridgeX ?? null,
        bridgeY: trunk.bridgeY ?? null,
        straight: trunk.straight
      });
      const values = polylinesByEdge.get(tap.logicalEdgeKey) || [];
      values.push({ hopIndex: tap.hopIndex, polyline });
      polylinesByEdge.set(tap.logicalEdgeKey, values);
    }
  }

  const routedEdges = new Map();
  const allPoints = [];
  let exceptionalEdgeCount = 0;
  for (const edge of orientation.edges) {
    const publicEdge = publicEdgeById.get(String(edge.publicId ?? edge.key));
    const source = placedByKey.get(edge.layoutSourceKey) || placedByKey.get(edge.sourceKey);
    const target = placedByKey.get(edge.layoutTargetKey) || placedByKey.get(edge.targetKey);
    const hops = (polylinesByEdge.get(edge.key) || [])
      .sort((left, right) => left.hopIndex - right.hopIndex)
      .map((entry) => entry.polyline);
    if (hops.length > 0) {
      const points = RestoreSemanticDirection(JoinChainPolylines(hops), edge.reversedForLayout);
      allPoints.push(...points);
      if (publicEdge) routedEdges.set(edge.key, { publicEdge, points });
      continue;
    }
    if (!publicEdge || !source || !target) continue;
    const sourceRole = edge.reversedForLayout ? "target" : "source";
    const targetRole = edge.reversedForLayout ? "source" : "target";
    const points = BuildExceptionalRoute({
      sourcePoint: getConnectionPoint(source, edge.reversedForLayout ? edge.targetPin : edge.sourcePin, sourceRole),
      targetPoint: getConnectionPoint(target, edge.reversedForLayout ? edge.sourcePin : edge.targetPin, targetRole),
      source,
      target,
      selfLoop: edge.ignoredForLayering,
      policy
    });
    exceptionalEdgeCount += 1;
    allPoints.push(...points);
    routedEdges.set(edge.key, { publicEdge, points });
  }

  return Object.freeze({ routedEdges, points: Object.freeze(allPoints), exceptionalEdgeCount, missingTrunkCount });
}

function BuildTrunkMap(plan, startPos, policy) {
  const result = new Map();
  const splitParts = new Map();
  for (const segment of plan.segments) {
    if (!segment.splitPartnerKey) continue;
    const isLeft = segment.segmentKey.endsWith("~left");
    const entry = splitParts.get(segment.physicalNetKey) || {};
    if (isLeft) entry.left = segment; else entry.right = segment;
    splitParts.set(segment.physicalNetKey, entry);
  }
  for (const segment of plan.segments) {
    if (segment.splitPartnerKey) continue;
    const slot = plan.slots.get(segment.segmentKey) ?? 0;
    result.set(segment.physicalNetKey, Object.freeze({
      trunkX: startPos + slot * policy.edgeEdgeSpacing,
      straight: segment.straight,
      bridgeX: null,
      bridgeY: null
    }));
  }
  for (const [physicalNetKey, parts] of splitParts) {
    if (!parts.left || !parts.right) continue;
    result.set(physicalNetKey, Object.freeze({
      trunkX: startPos + (plan.slots.get(parts.left.segmentKey) ?? 0) * policy.edgeEdgeSpacing,
      bridgeX: startPos + (plan.slots.get(parts.right.segmentKey) ?? 0) * policy.edgeEdgeSpacing,
      bridgeY: parts.left.bridgeY ?? parts.right.bridgeY ?? null,
      straight: false
    }));
  }
  return result;
}

function BuildPlacedNodes(graph, structure) {
  const publicNodeById = new Map((graph?.nodes || []).map((node) => [String(node.id), node]));
  const publicEdgeById = new Map((graph?.edges || []).map((edge) => [String(edge.id), edge]));
  const placedByKey = new Map();
  for (const row of structure.nodes) {
    const source = publicNodeById.get(row.key);
    if (row.dummy) {
      placedByKey.set(row.key, { ...row, publicSource: null });
      continue;
    }
    const size = { width: row.width, height: row.height };
    placedByKey.set(row.key, {
      ...(source || {}),
      ...row,
      publicSource: source || null,
      ports: source ? buildNodePorts(source, size) : []
    });
  }
  return { placedByKey, publicNodeById, publicEdgeById };
}

function BuildRankWidths(structure) {
  const widths = new Map();
  for (const node of structure.nodes) {
    if (node.dummy) continue;
    widths.set(node.rank, Math.max(widths.get(node.rank) || 0, Number(node.width) || 0));
  }
  return widths;
}

function NormalizePolicy(options) {
  const positive = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };
  return {
    margin: positive(options.margin, DEFAULT_ROUTER_POLICY.margin),
    edgeEdgeSpacing: positive(options.edgeEdgeSpacing, DEFAULT_ROUTER_POLICY.edgeEdgeSpacing),
    edgeNodeSpacing: positive(options.edgeNodeSpacing, DEFAULT_ROUTER_POLICY.edgeNodeSpacing),
    nodeNodeSpacing: positive(options.nodeNodeSpacing, DEFAULT_ROUTER_POLICY.nodeNodeSpacing),
    maximumActiveCandidates: Math.max(1, positive(options.maximumActiveCandidates,
      DEFAULT_ROUTER_POLICY.maximumActiveCandidates)),
    maximumBucketCandidates: Math.max(1, positive(options.maximumBucketCandidates,
      DEFAULT_ROUTER_POLICY.maximumBucketCandidates)),
    maximumSplitsPerBoundary: positive(options.maximumSplitsPerBoundary, 64)
  };
}

function Now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function Measure(action) {
  const startedAt = Now();
  const value = action();
  return { value, elapsedMs: Math.round((Now() - startedAt) * 1000) / 1000 };
}
