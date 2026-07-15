import { analyzeLayoutIntent } from "./layoutIntent.js";
import { DEFAULT_LAYOUT_POLICY, normalizeLayoutPolicy } from "./layoutPolicy.js";
import {
  buildNodePorts,
  computeBounds,
  DEFAULT_CELL_PIN_PITCH,
  measureNode
} from "./nodeGeometry.js";
import {
  alignDrivenTargetsToDriverPins,
  alignSingleConnectionEndpoints,
  applyBranchAwareLanes
} from "./nodeAlignment.js";
import {
  applyFanoutHubLocality,
  applySingleFanoutInputLocality
} from "./nodeLocality.js";
import { applyNodePositionOverrides, applyNodeSizeOverride } from "./nodeOverrides.js";
import {
  computeLevelXs,
  resolveExternalSourceOverlaps,
  resolveLevelOverlaps,
  resolveOutputOverlaps
} from "./nodeSpacing.js";
import { assignSimpleLevels, orderSimpleLayers } from "./simpleLayering.js";
import { routeSimpleEdges } from "./simpleOrthogonalRouter.js";
import { planSimpleRouting } from "./simpleRoutingPlan.js";

export const DEFAULT_WIRE_LANE_PITCH = 18;
export const DEFAULT_TOP_WIRE_LANE_PITCH = 16;
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
  const cellPinPitch = clamp(Number(policy.spacing.cellPinPitch) || DEFAULT_CELL_PIN_PITCH, 18, 72);
  const wireLanePitch = clamp(
    Number(policy.spacing.wireLanePitch) || DEFAULT_WIRE_LANE_PITCH,
    8,
    48
  );
  const topWireLanePitch = clamp(
    Number(options.topWireLanePitch) || Math.max(8, wireLanePitch - 2),
    8,
    48
  );
  const levels = assignSimpleLevels(graph);
  const layoutIntent = analyzeLayoutIntent(graph, levels);
  const routePlan = planSimpleRouting(graph, levels, layoutIntent);
  const xSpacing = Number(policy.spacing.x) || 260;
  const topWireSpace = options.topWireSpace || 80;
  const buckets = bucketNodesByLevel(graph.nodes, levels);
  const levelKeys = [...buckets.keys()].sort((left, right) => left - right);
  orderSimpleLayers(buckets, levelKeys, graph.edges);

  const nodeSizes = new Map(graph.nodes.map((node) => [
    node.id,
    applyNodeSizeOverride(measureNode(node, cellPinPitch), options.nodeSizes, node.id)
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

  applyPlacementPasses({
    positionedNodes,
    graph,
    levelKeys,
    layoutIntent,
    margin,
    topWireLanePitch,
    policy,
    nodePositions: options.nodePositions
  });

  const positionedEdges = routeSimpleEdges(graph, positionedNodes, {
    layoutIntent,
    routePlan,
    wireLanePitch,
    topWireLanePitch,
    margin
  });
  const bounds = computeBounds(positionedNodes);
  return {
    ...graph,
    nodes: positionedNodes,
    edges: positionedEdges,
    width: bounds.width + margin,
    height: bounds.height + margin
  };
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

function applyPlacementPasses(context) {
  const {
    positionedNodes,
    graph,
    levelKeys,
    layoutIntent,
    margin,
    topWireLanePitch,
    policy,
    nodePositions
  } = context;
  const compactGap = Number(policy.spacing.compactYGap) || 8;
  const fanoutGap = Number(policy.spacing.fanoutYGap) || 28;

  if (policy.features.branchAwareLanes) {
    applyBranchAwareLanes(
      positionedNodes,
      graph.edges,
      levelKeys,
      policy.spacing.branchTopY,
      policy.spacing.branchLanePitch
    );
  }
  if (policy.features.alignDrivenLinks) {
    alignDrivenTargetsToDriverPins(positionedNodes, graph.edges, levelKeys, layoutIntent, margin);
  }
  resolveLevelOverlaps(
    positionedNodes,
    levelKeys,
    margin,
    compactGap,
    layoutIntent,
    fanoutGap
  );
  alignSingleConnectionEndpoints(positionedNodes, graph.edges, layoutIntent);
  resolveExternalSourceOverlaps(positionedNodes, margin, compactGap);
  applyFanoutHubLocality(positionedNodes, graph.edges, margin);
  if (policy.features.localizeSingleFanoutInputs) {
    applySingleFanoutInputLocality(
      positionedNodes,
      graph.edges,
      margin,
      layoutIntent,
      topWireLanePitch
    );
  }
  resolveOutputOverlaps(positionedNodes, margin);
  applyNodePositionOverrides(positionedNodes, nodePositions);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
