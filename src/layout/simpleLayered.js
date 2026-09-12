import { analyzeLayoutIntent } from "./layoutIntent.js";
import {
  applyRoutingCapacityExpansion,
  buildRoutingCapacityPlan,
  normalizeRoutingGeometry
} from "./channelCapacity.js";
import { DEFAULT_LAYOUT_POLICY, normalizeLayoutPolicy } from "./layoutPolicy.js";
import {
  buildNodePorts,
  computeBoundsWithRoutes,
  DEFAULT_CELL_PIN_PITCH,
  measureNode,
  translateLayoutGeometry
} from "./nodeGeometry.js";
import { applyNodeSizeOverride } from "./nodeOverrides.js";
import {
  computeLevelXs
} from "./nodeSpacing.js";
import { assignSimpleLevels, orderSimpleLayers } from "./simpleLayering.js";
import { routeSimpleEdges } from "./simpleOrthogonalRouter.js";
import { runSimplePlacementPipeline } from "./simplePlacementPipeline.js";
import { planSimpleRouting } from "./simpleRoutingPlan.js";
import { buildWireRoutes } from "./wireRoutes.js";

export const DEFAULT_WIRE_LANE_PITCH = DEFAULT_LAYOUT_POLICY.spacing.wireLanePitch;
export const DEFAULT_TOP_WIRE_LANE_PITCH = DEFAULT_LAYOUT_POLICY.spacing.wireLanePitch;
export { DEFAULT_LAYOUT_POLICY };
export {
  DEFAULT_CELL_PIN_PITCH,
  DEFAULT_INPUT_NODE_HEIGHT,
  DEFAULT_PIN_NODE_HEIGHT
} from "./nodeGeometry.js";

export function layoutGraph(graph, options = {}) {
  const policy = normalizeLayoutPolicy(options.layoutPolicy, options);
  const ySpacing = policy.spacing.y;
  const margin = policy.spacing.margin;
  const cellPinPitch = policy.spacing.cellPinPitch;
  const wireLanePitch = policy.spacing.wireLanePitch;
  const routingGeometry = normalizeRoutingGeometry(policy.spacing, options.routingGeometry);
  const topWireLanePitch = routingGeometry.wireLanePitch;
  const levels = assignSimpleLevels(graph);
  const layoutIntent = analyzeLayoutIntent(graph, levels);
  const routePlan = planSimpleRouting(graph, levels, layoutIntent);
  const xSpacing = policy.spacing.x;
  const topWireSpace = Number.isFinite(Number(options.topWireSpace))
    ? Math.max(0, Number(options.topWireSpace))
    : 80;
  const buckets = bucketNodesByLevel(graph.nodes, levels);
  const levelKeys = [...buckets.keys()].sort((left, right) => left - right);
  orderSimpleLayers(buckets, levelKeys, graph.edges);

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
    policy.spacing
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

  const initialCapacityPlan = buildRoutingCapacityPlan(
    graph,
    levels,
    positionedNodes,
    layoutIntent,
    {
      spacing: policy.spacing,
      routingGeometry,
      "outer-topSpan": topWireSpace
    }
  );
  applyRoutingCapacityExpansion(positionedNodes, initialCapacityPlan);
  const routingCapacity = buildRoutingCapacityPlan(
    graph,
    levels,
    positionedNodes,
    layoutIntent,
    {
      spacing: policy.spacing,
      routingGeometry,
      "outer-topSpan": topWireSpace
    }
  );

  const positionedEdges = routeSimpleEdges(graph, positionedNodes, {
    layoutIntent,
    routePlan,
    wireLanePitch,
    topWireLanePitch,
    routingGeometry,
    routingCapacity,
    margin,
    onRoutingProgress: options.onRoutingProgress,
    onRoutingStage: options.onRoutingStage
  });
  const wireRoutes = buildWireRoutes(positionedEdges);
  const bounds = computeBoundsWithRoutes(positionedNodes, positionedEdges, wireRoutes);
  translateLayoutGeometry(positionedNodes, positionedEdges, wireRoutes, {
    x: Math.max(0, -bounds.left),
    y: Math.max(0, -bounds.top)
  });
  const normalizedBounds = computeBoundsWithRoutes(positionedNodes, positionedEdges, wireRoutes);
  return {
    ...graph,
    nodes: positionedNodes,
    edges: positionedEdges,
    wireRoutes,
    routingCapacity,
    width: normalizedBounds.width + margin,
    height: normalizedBounds.height + margin
  };
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
