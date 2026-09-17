import assert from "node:assert/strict";
import test from "node:test";
import {
  applyBalancedLayerPlacement,
  buildAlignmentBlocks,
  chooseBalancedPlacement,
  compactOrderedLayer
} from "../../src/layout/layered/balancedPlacement.js";

function node(id, level, order, height = 20, pinY = 10) {
  return {
    id, kind: "cell", label: id, level, order, x: level * 100, y: 0,
    width: 60, height,
    ports: [
      { pin: "A", direction: "input", x: 0, y: pinY },
      { pin: "Y", direction: "output", x: 60, y: pinY }
    ]
  };
}

test("balanced placement centres shorter layers instead of top-aligning them", () => {
  const nodes = [
    node("a0", 0, 0), node("a1", 0, 1), node("a2", 0, 2),
    node("b0", 1, 0)
  ];
  applyBalancedLayerPlacement(nodes, [], [0, 1], { minimumY: 40, gap: 10, sweeps: 0 });

  assert.equal(nodes[0].y, 40);
  assert.equal(nodes[3].y, 70);
});

test("ordered compaction preserves order and minimum separation", () => {
  const nodes = [node("a", 0, 0), node("b", 0, 1), node("c", 0, 2)];
  const result = compactOrderedLayer(nodes, [100, 20, 40], 10, 8);

  assert.ok(result[0] >= 10);
  assert.ok(result[1] >= result[0] + nodes[0].height + 8);
  assert.ok(result[2] >= result[1] + nodes[1].height + 8);
});

test("balanced placement is independent of node and edge array order", () => {
  const original = [node("a", 0, 0), node("b", 0, 1), node("c", 1, 0), node("d", 1, 1)];
  const edges = [
    { id: "ac", source: "a", target: "c", sourcePin: "Y", targetPin: "A" },
    { id: "bd", source: "b", target: "d", sourcePin: "Y", targetPin: "A" }
  ];
  const permuted = original.toReversed().map((entry) => ({
    ...entry,
    ports: entry.ports.map((port) => ({ ...port }))
  }));

  applyBalancedLayerPlacement(original, edges, [0, 1], { minimumY: 10, gap: 8 });
  applyBalancedLayerPlacement(permuted, edges.toReversed(), [0, 1], { minimumY: 10, gap: 8 });

  const first = new Map(original.map((entry) => [entry.id, entry.y]));
  assert.deepEqual(new Map(permuted.map((entry) => [entry.id, entry.y])), first);
});

test("candidate selection rejects a material column-centre regression", () => {
  const legacy = [node("a", 0, 0), node("b", 0, 1), node("c", 1, 0)];
  legacy[0].y = 0;
  legacy[1].y = 28;
  legacy[2].y = 14;
  const candidate = legacy.map((entry) => ({
    ...entry,
    ports: entry.ports.map((port) => ({ ...port }))
  }));
  candidate[2].y = 100;

  const selection = chooseBalancedPlacement(legacy, candidate, [], { gap: 8 });

  assert.equal(selection.selected, "legacy");
  assert.equal(selection.reason, "column-center-regression");
  assert.equal(selection.nodes, legacy);
});

test("candidate selection accepts a compact aligned placement", () => {
  const legacy = [node("a", 0, 0), node("b", 1, 0)];
  legacy[0].y = 10;
  legacy[1].y = 50;
  const candidate = legacy.map((entry) => ({
    ...entry,
    ports: entry.ports.map((port) => ({ ...port }))
  }));
  candidate[1].y = 10;
  const edges = [{ source: "a", target: "b", sourcePin: "Y", targetPin: "A" }];

  const selection = chooseBalancedPlacement(legacy, candidate, edges, { gap: 8 });

  assert.equal(selection.selected, "balanced");
  assert.equal(selection.reason, "lower-placement-score");
  assert.equal(selection.candidate.alignedEdgeCount, 1);
});

test("alignment blocks choose a median predecessor and keep one node per layer", () => {
  const nodes = [
    node("a", 0, 0), node("b", 0, 1), node("c", 0, 2),
    node("d", 1, 0), node("e", 2, 0)
  ];
  const edges = [
    { id: "ad", source: "a", target: "d", sourcePin: "Y", targetPin: "A" },
    { id: "bd", source: "b", target: "d", sourcePin: "Y", targetPin: "A" },
    { id: "cd", source: "c", target: "d", sourcePin: "Y", targetPin: "A" },
    { id: "de", source: "d", target: "e", sourcePin: "Y", targetPin: "A" }
  ];

  const result = buildAlignmentBlocks(nodes, edges, [0, 1, 2]);

  assert.deepEqual(result.alignedEdges.map((edge) => edge.id), ["bd", "de"]);
  assert.deepEqual(result.blocks[0].members.map((member) => member.nodeId), ["b", "d", "e"]);
  assert.equal(new Set(result.blocks[0].members.map((member) => member.level)).size, 3);
});

test("alignment block construction is invariant to node and edge permutations", () => {
  const nodes = [node("a", 0, 0), node("b", 0, 1), node("c", 1, 0), node("d", 2, 0)];
  const edges = [
    { id: "ac", source: "a", target: "c", sourcePin: "Y", targetPin: "A" },
    { id: "bc", source: "b", target: "c", sourcePin: "Y", targetPin: "A" },
    { id: "cd", source: "c", target: "d", sourcePin: "Y", targetPin: "A" }
  ];
  const summarize = (result) => result.blocks.map((block) =>
    block.members.map((member) => `${member.nodeId}:${member.offset}`).join("|"));

  assert.deepEqual(
    summarize(buildAlignmentBlocks(nodes, edges, [0, 1, 2])),
    summarize(buildAlignmentBlocks(nodes.toReversed(), edges.toReversed(), [0, 1, 2]))
  );
});

test("alignment blocks leave fanout branches as soft preferences", () => {
  const nodes = [node("source", 0, 0), node("left", 1, 0), node("right", 1, 1)];
  const edges = [
    { id: "sl", source: "source", target: "left", sourcePin: "Y", targetPin: "A" },
    { id: "sr", source: "source", target: "right", sourcePin: "Y", targetPin: "A" }
  ];

  const result = buildAlignmentBlocks(nodes, edges, [0, 1]);

  assert.deepEqual(result.blocks, []);
  assert.deepEqual(result.alignedEdges, []);
});

test("alignment blocks leave terminal placement to its owning stage", () => {
  const source = node("source", 0, 0);
  const output = { ...node("output", 1, 0), kind: "focus-output" };
  const result = buildAlignmentBlocks([source, output], [{
    id: "terminal",
    source: "source",
    target: "output",
    sourcePin: "Y",
    targetPin: "A"
  }], [0, 1]);

  assert.deepEqual(result.blocks, []);
  assert.deepEqual(result.alignedEdges, []);
});
