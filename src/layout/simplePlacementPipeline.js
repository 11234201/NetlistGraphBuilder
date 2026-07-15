import {
  alignDrivenTargetsToDriverPins,
  alignSingleConnectionEndpoints,
  applyBranchAwareLanes
} from "./nodeAlignment.js";
import {
  applyFanoutHubLocality,
  applySingleFanoutInputLocality
} from "./nodeLocality.js";
import { applyNodePositionOverrides } from "./nodeOverrides.js";
import {
  resolveExternalSourceOverlaps,
  resolveLevelOverlaps,
  resolveOutputOverlaps
} from "./nodeSpacing.js";

export const SIMPLE_PLACEMENT_STAGES = Object.freeze([
  "branch-aware-lanes",
  "align-driven-links",
  "resolve-level-overlaps",
  "align-single-connections",
  "resolve-source-overlaps",
  "localize-fanout-hubs",
  "localize-single-fanout-inputs",
  "resolve-output-overlaps",
  "apply-node-overrides"
]);

export function runSimplePlacementPipeline(context, hooks = {}) {
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
  const run = (stage, action) => {
    action();
    hooks.onStage?.(stage, positionedNodes);
  };

  if (policy.features.branchAwareLanes) {
    run("branch-aware-lanes", () => applyBranchAwareLanes(
      positionedNodes,
      graph.edges,
      levelKeys,
      policy.spacing.branchTopY,
      policy.spacing.branchLanePitch
    ));
  }
  if (policy.features.alignDrivenLinks) {
    run("align-driven-links", () => alignDrivenTargetsToDriverPins(
      positionedNodes,
      graph.edges,
      levelKeys,
      layoutIntent,
      margin
    ));
  }
  run("resolve-level-overlaps", () => resolveLevelOverlaps(
    positionedNodes,
    levelKeys,
    margin,
    compactGap,
    layoutIntent,
    fanoutGap
  ));
  run("align-single-connections", () => alignSingleConnectionEndpoints(
    positionedNodes,
    graph.edges,
    layoutIntent
  ));
  run("resolve-source-overlaps", () => resolveExternalSourceOverlaps(
    positionedNodes,
    margin,
    compactGap
  ));
  run("localize-fanout-hubs", () => applyFanoutHubLocality(
    positionedNodes,
    graph.edges,
    margin
  ));
  if (policy.features.localizeSingleFanoutInputs) {
    run("localize-single-fanout-inputs", () => applySingleFanoutInputLocality(
      positionedNodes,
      graph.edges,
      margin,
      layoutIntent,
      topWireLanePitch
    ));
  }
  run("resolve-output-overlaps", () => resolveOutputOverlaps(positionedNodes, margin));
  run("apply-node-overrides", () => applyNodePositionOverrides(positionedNodes, nodePositions));
  return positionedNodes;
}
