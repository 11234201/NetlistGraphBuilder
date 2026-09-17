import { analyzeLayoutIntent } from "./layoutIntent.js";
import {
  applyRoutingCapacityExpansion,
  buildRoutingCapacityPlan,
  computeTopWireHeadroom,
  normalizeRoutingGeometry
} from "./channelCapacity.js";
import { relaxToMinimalSpan } from "./layered/minSpanLayering.js";
import { stripDummyNodes } from "./layered/longEdgeDummies.js";
import {
  applyCarrierPlacementSlots,
  reserveLeadingCarrierLane
} from "./layered/carrier_placement.js";
import { buildLayeredGraph } from "./layered/layered_graph.js";
import { buildCarrierPhysicalNetRoutes } from "./layered/carrier_routing.js";
import { DEFAULT_LAYOUT_POLICY, normalizeLayoutPolicy } from "./layoutPolicy.js";
import {
  buildNodePorts,
  computeBoundsWithRoutes,
  computeSafeLayoutExtent,
  DEFAULT_CELL_PIN_PITCH,
  measureNode,
  translateLayoutGeometry
} from "./nodeGeometry.js";
import { applyNodeSizeOverride } from "./nodeOverrides.js";
import {
  computeLevelXs,
  resolveExternalSourceEscapeOverlaps
} from "./nodeSpacing.js";
import { assignSimpleLevels, orderSimpleLayers } from "./simpleLayering.js";
import { routeSimpleEdges } from "./simpleOrthogonalRouter.js";
import { runSimplePlacementPipeline } from "./simplePlacementPipeline.js";
import { planSimpleRouting } from "./simpleRoutingPlan.js";
import { buildWireRoutes } from "./wireRoutes.js";
import { finalizeLayoutGraph } from "./layoutValidator.js";

export const DEFAULT_WIRE_LANE_PITCH = DEFAULT_LAYOUT_POLICY.spacing.wireLanePitch;
export const DEFAULT_TOP_WIRE_LANE_PITCH = DEFAULT_LAYOUT_POLICY.spacing.wireLanePitch;
export { DEFAULT_LAYOUT_POLICY };
export {
  DEFAULT_CELL_PIN_PITCH,
  DEFAULT_INPUT_NODE_HEIGHT,
  DEFAULT_PIN_NODE_HEIGHT
} from "./nodeGeometry.js";

export function layoutGraph(graph, options = {}) {
  const layoutStartedAt = now();
  let previousStageAt = layoutStartedAt;
  const layoutStages = [];
  const reportStage = (stage, detail = null) => {
    const stageAt = now();
    const timing = Object.freeze({
      stage,
      elapsedMs: roundMilliseconds(stageAt - layoutStartedAt),
      deltaMs: roundMilliseconds(stageAt - previousStageAt)
    });
    layoutStages.push(timing);
    previousStageAt = stageAt;
    options.onLayoutStage?.(stage, detail, timing);
  };
  const policy = normalizeLayoutPolicy(options.layoutPolicy, options);
  const ySpacing = policy.spacing.y;
  const margin = policy.spacing.margin;
  const cellPinPitch = policy.spacing.cellPinPitch;
  const wireLanePitch = policy.spacing.wireLanePitch;
  const routingGeometry = normalizeRoutingGeometry(policy.spacing, options.routingGeometry);
  const topWireLanePitch = routingGeometry.wireLanePitch;
  // Source-anchored longest-path ranking can leave boundary nodes far from
  // deep consumers. The experimental bounded span relaxation moves eligible
  // nodes toward the tighter side of their constraints.
  const initialLevels = assignSimpleLevels(graph);
  const levels = policy.features.minimalSpanLayering
    ? relaxToMinimalSpan(graph, initialLevels, policy.layering)
    : initialLevels;
  reportStage("levels-complete");
  const layoutIntent = analyzeLayoutIntent(graph, levels);
  reportStage("intent-complete");
  const routePlan = planSimpleRouting(graph, levels, layoutIntent);
  reportStage("route-plan-complete");
  const xSpacing = policy.spacing.x;
  const requestedTopWireSpace = Number.isFinite(Number(options.topWireSpace))
    ? Math.max(0, Number(options.topWireSpace))
    : 80;
  const groupBoundaryDemand = graph.nodes.some((node) => node.kind === "group")
    ? routePlan.longLaneCount
    : 0;
  const topWireHeadroom = computeTopWireHeadroom(
    groupBoundaryDemand,
    routingGeometry,
    margin,
    requestedTopWireSpace
  );
  const topWireSpace = topWireHeadroom.topWireSpace;
  let buckets = bucketNodesByLevel(graph.nodes, levels);
  let levelKeys = [...buckets.keys()].sort((left, right) => left - right);
  // A long edge is invisible to every column it passes through: it contributes
  // a barycenter only at its two endpoints. Splitting it into a chain of
  // dummies makes it a normal unit-span edge in each of those columns, which is
  // the only way it can take part in their ordering. The dummies are stripped
  // again immediately after ordering; nothing downstream sees them yet.
  const hasFocusedBoundary = graph.nodes.some((node) =>
    node.kind === "focus-input" || node.kind === "focus-output");
  const useProperLayering = hasFocusedBoundary || (
    policy.features.wholeProperLayering &&
    graph.nodes.length >= policy.layering.wholeProperLayeringMinimumNodes
  );
  const carrierMinimumFanout = hasFocusedBoundary
    ? policy.layering.carrierMinimumFanout
    : policy.layering.wholeCarrierMinimumFanout;
  const carrierMinimumSpan = hasFocusedBoundary
    ? Number.POSITIVE_INFINITY
    : policy.layering.wholeCarrierMinimumSpan;
  const hasExplicitFocusedFanoutX =
    options.layoutPolicy?.spacing?.focusedFanoutX !== undefined;
  const hasExplicitFanoutX = options.layoutPolicy?.spacing?.fanoutX !== undefined ||
    options.fanoutX !== undefined;
  const adaptiveSpacing = hasFocusedBoundary
    ? {
      ...policy.spacing,
      fanoutX: hasExplicitFocusedFanoutX || !hasExplicitFanoutX
        ? policy.spacing.focusedFanoutX
        : policy.spacing.fanoutX
    }
    : policy.spacing;
  const layeredGraph = policy.features.longEdgeDummies && useProperLayering
    ? buildLayeredGraph(graph, {
      levels,
      layering: policy.layering,
      placement: {
        carrierSpan: wireLanePitch,
        minimumFanout: carrierMinimumFanout,
        minimumSpan: carrierMinimumSpan,
        minimumLongSpanSourceColumn: hasFocusedBoundary ? 0 : 1
      }
    })
    : null;
  if (layeredGraph) {
    buckets = new Map(layeredGraph.layers.map((layer) => [layer.level, [...layer.nodes]]));
    levelKeys = layeredGraph.layers.map((layer) => layer.level);
    stripDummyNodes(buckets, layeredGraph.logicalChains);
  } else {
    orderSimpleLayers(buckets, levelKeys, graph.edges);
  }
  reportStage("layer-order-complete");
  const useRoutingDrivenLayerSpacing = policy.features.routingDrivenLayerSpacing &&
    Boolean(layeredGraph) &&
    (hasFocusedBoundary || (layeredGraph.logicalChains?.dummies?.length || 0) > 0);

  const nodeSizes = new Map(graph.nodes.map((node) => [
    node.id,
    applyNodeSizeOverride(readMeasuredSize(node, cellPinPitch), options.nodeSizes, node.id)
  ]));
  const levelXs = computeLevelXs(
    graph,
    levels,
    buckets,
    levelKeys,
    nodeSizes,
    xSpacing,
    margin,
    policy.features.localizeSingleFanoutInputs,
    layoutIntent,
    adaptiveSpacing,
    useRoutingDrivenLayerSpacing
  );
  const positionedNodes = placeInitialNodes({
    buckets,
    levelKeys,
    levelXs,
    nodeSizes,
    cellPinPitch,
    topWireSpace,
    margin,
    ySpacing,
    layoutIntent,
    policy
  });

  runSimplePlacementPipeline({
    positionedNodes,
    graph,
    levelKeys,
    layoutIntent,
    margin,
    topWireLanePitch,
    policy,
    nodePositions: options.nodePositions
  }, { onStage: options.onPlacementStage });
  let carrierPlacement = null;
  if (layeredGraph && policy.features.physicalCarrierRouting) {
    carrierPlacement = applyCarrierPlacementSlots(
      positionedNodes,
      layeredGraph.placementLayers,
      {
        useActualGaps: true
      }
    );
  }
  reportStage("placement-complete");

  const initialCapacityPlan = buildRoutingCapacityPlan(
    graph,
    levels,
    positionedNodes,
    layoutIntent,
    {
      spacing: policy.spacing,
      routingGeometry,
      "outer-topSpan": topWireSpace,
      topWireHeadroom
    }
  );
  applyRoutingCapacityExpansion(positionedNodes, initialCapacityPlan);
  reportStage("capacity-expansion-complete");
  if ((carrierPlacement?.carrierYById?.size || 0) > 0) {
    reserveLeadingCarrierLane(positionedNodes, wireLanePitch);
  }
  // Row-gap capacity expansion can move only part of a source column and
  // create a new line-of-sight obstruction that did not exist during the
  // normal locality pipeline. Repair the final source-to-group escape rows
  // once, after capacity geometry is final and before rebuilding assignments.
  resolveExternalSourceEscapeOverlaps(
    positionedNodes,
    graph.edges,
    margin,
    policy.spacing.cellSpacing
  );
  if (carrierPlacement) {
    carrierPlacement = applyCarrierPlacementSlots(
      positionedNodes,
      layeredGraph.placementLayers,
      { useActualGaps: true }
    );
  }
  const routingCapacity = buildRoutingCapacityPlan(
    graph,
    levels,
    positionedNodes,
    layoutIntent,
    {
      spacing: policy.spacing,
      routingGeometry,
      "outer-topSpan": topWireSpace,
      topWireHeadroom
    }
  );
  reportStage("capacity-plan-complete");

  const carrierRouting = carrierPlacement
    ? buildCarrierPhysicalNetRoutes(
      layeredGraph,
      positionedNodes,
      carrierPlacement.carrierYById,
      {
        // Whole graphs can contain thousands of carrier branches. Their
        // variants are fallback geometry, not a graph-sized search budget.
        // Keep the richer repair family for Focused views and one canonical
        // carrier candidate for ordinary Whole graphs. Long single-load nets
        // need only the nearest two bounded repair offsets; avoid multiplying
        // validation work for graphs such as eq007 that contain high-fanout
        // carriers but no eligible long single-load carrier.
        anchorOffsets: hasFocusedBoundary
          ? [0, -8, 8, -16, 16, -24, 24, -32, 32]
          : hasEligibleLongSingleCarriers(
              layeredGraph.carriers,
              carrierMinimumFanout,
              carrierMinimumSpan,
              1
            )
            ? [0, -8, 8]
            : [0]
      }
    )
    : null;
  const carrierRoutesByPhysicalNet = new Map((carrierRouting?.groups || [])
    .filter((group) => group.variants.some((variant) => variant.commit.status === "routed") &&
      isCarrierPhysicalNetEligible(
        group.physicalNetKey,
        group.edges.length,
        layeredGraph?.carriers,
        carrierMinimumFanout,
        carrierMinimumSpan,
        hasFocusedBoundary ? 0 : 1
      ))
    .map((group) => [
      group.physicalNetKey,
      group.variants
        .filter((variant) => variant.commit.status === "routed")
        .map((variant) => variant.edges)
    ]));
  reportStage("carrier-routing-complete", carrierRouting ? {
    groupCount: carrierRouting.groups.length,
    validGroupCount: carrierRoutesByPhysicalNet.size,
    diagnosticCounts: countDiagnosticCodes(carrierRouting.diagnostics),
    violationCounts: countCarrierViolationCodes(carrierRouting.diagnostics)
  } : null);

  const positionedEdges = routeSimpleEdges(graph, positionedNodes, {
    layoutIntent,
    routePlan,
    wireLanePitch,
    topWireLanePitch,
    routingGeometry,
    routingCapacity,
    carrierRoutesByPhysicalNet,
    carrierRoutingSummary: carrierRouting ? {
      groupCount: carrierRouting.groups.length,
      validGroupCount: carrierRoutesByPhysicalNet.size,
      coverage: carrierRouting.coverage,
      diagnosticCounts: countDiagnosticCodes(carrierRouting.diagnostics),
      violationCounts: countCarrierViolationCodes(carrierRouting.diagnostics),
      diagnosticSamples: carrierRouting.diagnostics
        .filter((diagnostic) => diagnostic.code === "layered-carrier-physical-net-invalid")
        .slice(0, 8)
    } : null,
    margin,
    strictRouting: options.strictRouting === true,
    onRoutingProgress: options.onRoutingProgress,
    onRoutingStage: options.onRoutingStage,
    onRoutingGroup: options.onRoutingGroup,
    onRoutingEdge: options.onRoutingEdge
  });
  reportStage("routing-complete", positionedEdges.routingMetrics || null);
  const wireRoutes = buildWireRoutes(positionedEdges);
  reportStage("wire-routes-complete");
  const bounds = computeBoundsWithRoutes(positionedNodes, positionedEdges, wireRoutes);
  translateLayoutGeometry(positionedNodes, positionedEdges, wireRoutes, {
    x: Math.max(0, -bounds.left),
    y: Math.max(0, -bounds.top)
  });
  const normalizedBounds = computeBoundsWithRoutes(positionedNodes, positionedEdges, wireRoutes);
  const safeExtent = computeSafeLayoutExtent(normalizedBounds, margin);
  const result = finalizeLayoutGraph({
    ...graph,
    nodes: positionedNodes,
    edges: positionedEdges,
    wireRoutes,
    routingCapacity,
    routingMetrics: positionedEdges.routingMetrics || null,
    width: safeExtent.width,
    height: safeExtent.height,
    placementCapacity: {
      topWireHeadroom
    },
    layeredDiagnostics: layeredGraph?.diagnostics || []
  });
  reportStage("validation-complete", result.validationMetrics || null);
  result.layoutMetrics = Object.freeze({
    elapsedMs: roundMilliseconds(now() - layoutStartedAt),
    stages: Object.freeze(layoutStages.map((stage) => Object.freeze({ ...stage }))),
    layered: Object.freeze({
      enabled: Boolean(layeredGraph),
      dummyCount: layeredGraph?.logicalChains?.dummies?.length || 0,
      splitEdgeCount: layeredGraph?.logicalChains?.chainsByEdge?.size || 0,
      carrierCount: layeredGraph?.carriers?.length || 0,
      diagnosticCounts: Object.freeze(countDiagnosticCodes(layeredGraph?.diagnostics || []))
    })
  });
  return result;
}

function isCarrierPhysicalNetEligible(
  physicalNetKey,
  fanout,
  carriers,
  minimumFanout,
  minimumSpan,
  minimumLongSpanSourceColumn
) {
  if (fanout >= minimumFanout) return true;
  return (carriers || []).some((carrier) =>
    carrier.netGroupKey === physicalNetKey &&
    Number(carrier.physicalNetSpan) >= minimumSpan &&
    Number(carrier.sourceColumn) >= minimumLongSpanSourceColumn);
}

function hasEligibleLongSingleCarriers(
  carriers,
  minimumFanout,
  minimumSpan,
  minimumSourceColumn
) {
  return (carriers || []).some((carrier) =>
    Number(carrier.physicalNetFanout) < minimumFanout &&
    Number(carrier.physicalNetSpan) >= minimumSpan &&
    Number(carrier.sourceColumn) >= minimumSourceColumn);
}

function countDiagnosticCodes(diagnostics = []) {
  const counts = {};
  for (const diagnostic of diagnostics) {
    const code = diagnostic?.code || "unknown";
    counts[code] = (counts[code] || 0) + 1;
  }
  return counts;
}

function countCarrierViolationCodes(diagnostics = []) {
  const counts = {};
  for (const diagnostic of diagnostics) {
    for (const [code, count] of Object.entries(diagnostic?.violationCounts || {})) {
      counts[code] = (counts[code] || 0) + Number(count || 0);
    }
  }
  return counts;
}

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function roundMilliseconds(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function readMeasuredSize(node, cellPinPitch) {
  return Number.isFinite(node.width) && Number.isFinite(node.height)
    ? { width: node.width, height: node.height }
    : measureNode(node, cellPinPitch);
}

function bucketNodesByLevel(nodes, levels) {
  const buckets = new Map();
  for (const node of nodes) {
    const level = levels.get(node.id) || 0;
    if (!buckets.has(level)) buckets.set(level, []);
    buckets.get(level).push(node);
  }
  return buckets;
}

function placeInitialNodes(context) {
  const {
    buckets,
    levelKeys,
    levelXs,
    nodeSizes,
    cellPinPitch,
    topWireSpace,
    margin,
    ySpacing,
    layoutIntent,
    policy
  } = context;
  const positionedNodes = [];
  for (const level of levelKeys) {
    let nextY = topWireSpace + margin;
    for (const node of buckets.get(level)) {
      const size = nodeSizes.get(node.id);
      positionedNodes.push({
        ...node,
        x: levelXs.get(level),
        y: nextY,
        level,
        width: size.width,
        height: size.height,
        ports: buildNodePorts(node, size, cellPinPitch)
      });
      const nodeGap = layoutIntent.getNodeFanout(node) > 1
        ? Number(policy.spacing.fanoutYGap) || 28
        : Number(policy.spacing.compactYGap) || 8;
      nextY += Math.min(ySpacing, size.height + nodeGap);
    }
  }
  return positionedNodes;
}
