import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_LAYOUT_POLICY } from "../../src/layout/layoutPolicy.js";
import {
  runSimplePlacementPipeline,
  SIMPLE_PLACEMENT_STAGES
} from "../../src/layout/simplePlacementPipeline.js";

function createContext(features = DEFAULT_LAYOUT_POLICY.features) {
  return {
    positionedNodes: [],
    graph: { edges: [] },
    levelKeys: [],
    layoutIntent: { netGroups: new Map() },
    margin: 48,
    topWireLanePitch: 16,
    policy: {
      spacing: DEFAULT_LAYOUT_POLICY.spacing,
      features
    },
    nodePositions: null
  };
}

test("Simple placement executes its declared stages in a stable order", () => {
  const stages = [];
  const context = createContext();
  const result = runSimplePlacementPipeline(context, {
    onStage: (stage, nodes) => {
      stages.push(stage);
      assert.equal(nodes, context.positionedNodes);
    }
  });

  assert.equal(result, context.positionedNodes);
  assert.deepEqual(stages, SIMPLE_PLACEMENT_STAGES);
});

test("disabled placement features omit only their owning stages", () => {
  const stages = [];
  runSimplePlacementPipeline(createContext({
    alignDrivenLinks: false,
    branchAwareLanes: false,
    localizeSingleFanoutInputs: false
  }), { onStage: (stage) => stages.push(stage) });

  assert.deepEqual(stages, SIMPLE_PLACEMENT_STAGES.filter((stage) => ![
    "branch-aware-lanes",
    "align-driven-links",
    "localize-single-fanout-inputs"
  ].includes(stage)));
});
