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

test("Simple placement preserves cell spacing after localizing input ports", () => {
  const positionedNodes = [
    {
      id: "input:a", kind: "input", label: "a", x: 0, y: 0, width: 40, height: 20,
      ports: [{ pin: "a", direction: "output", x: 40, y: 10, side: "right" }]
    },
    {
      id: "input:b", kind: "input", label: "b", x: 0, y: 0, width: 40, height: 20,
      ports: [{ pin: "b", direction: "output", x: 40, y: 10, side: "right" }]
    },
    {
      id: "cell:u0", kind: "cell", label: "u0", x: 240, y: 80, width: 80, height: 80,
      ports: [
        { pin: "A", direction: "input", x: 0, y: 24, side: "left" },
        { pin: "B", direction: "input", x: 0, y: 56, side: "left" }
      ]
    }
  ];
  const edges = [
    { source: "input:a", target: "cell:u0", sourcePin: "a", targetPin: "A", net: "a" },
    { source: "input:b", target: "cell:u0", sourcePin: "b", targetPin: "B", net: "b" }
  ];
  const context = createContext();
  context.positionedNodes = positionedNodes;
  context.graph = { edges };
  context.layoutIntent = {
    netGroups: new Map(),
    getBoundaryPressure: () => 1,
    getEdge: () => ({}),
    getNodeFanout: () => 1
  };
  context.policy = {
    ...context.policy,
    spacing: { ...context.policy.spacing, cellSpacing: 64 }
  };

  runSimplePlacementPipeline(context);

  const inputs = positionedNodes
    .filter((node) => node.kind === "input")
    .toSorted((left, right) => left.y - right.y);
  assert.ok(inputs[1].y - inputs[0].y - inputs[0].height >= 64);
  assert.equal(positionedNodes[2].x - (inputs[0].x + inputs[0].width), 80);
});
