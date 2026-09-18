import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFocusedFaninTreeBlocks,
  buildFocusedFaninHierarchy,
  applyFocusedFaninTreeBlockPlacement,
  applyRecursiveFocusedFaninTreePlacement,
  summarizeFocusedFaninTreeBlocks
} from "../../src/layout/layered/focusedTreeBlocks.js";

function fixture() {
  const nodes = [
    { id: "root", kind: "cell", isFocusedRoot: true, level: 3, y: 100 },
    { id: "a", kind: "cell", level: 2, y: 0 },
    { id: "b", kind: "cell", level: 2, y: 200 },
    { id: "a-leaf", kind: "cell", level: 1, y: 0 },
    { id: "shared", kind: "cell", level: 1, y: 100 },
    { id: "b-leaf", kind: "cell", level: 1, y: 200 }
  ];
  const edges = [
    { id: "ar", source: "a", target: "root" },
    { id: "br", source: "b", target: "root" },
    { id: "aa", source: "a-leaf", target: "a" },
    { id: "sa", source: "shared", target: "a" },
    { id: "sb", source: "shared", target: "b" },
    { id: "bb", source: "b-leaf", target: "b" }
  ];
  return { nodes, edges };
}

test("fanin tree decomposition retains shared leaves once with all owners", () => {
  const { nodes, edges } = fixture();
  const result = buildFocusedFaninTreeBlocks(nodes, edges);
  assert.deepEqual(result.branchRootIds, ["a", "b"]);
  assert.deepEqual(result.membershipByNodeId.get("shared").ownerIds, ["a", "b"]);
  assert.equal(result.entries.filter((entry) => entry.nodeId === "shared").length, 1);
  assert.equal(summarizeFocusedFaninTreeBlocks(nodes, edges).sharedNodeCount, 1);
});

test("recursive tree placement centres sibling subtrees around their parent", () => {
  const { nodes, edges } = fixture();
  for (const node of nodes) node.x = node.level * 100;
  applyFocusedFaninTreeBlockPlacement(nodes, edges, [1, 2, 3], {
    gap: 8,
    groupGap: 40,
    targetCenter: 100
  });
  const result = applyRecursiveFocusedFaninTreePlacement(nodes, edges, [1, 2, 3], {
    gap: 8,
    siblingGap: 40
  });
  assert.equal(result.branchCount, 2);
  assert.equal(result.desiredNodeCount, 4);
  assert.ok(result.layerCount >= 2);
  assert.equal(summarizeFocusedFaninTreeBlocks(nodes, edges).fragmentedGroupCount, 0);
});

test("recursive tree placement is invariant to graph array order", () => {
  const first = fixture();
  const second = fixture();
  second.nodes.reverse();
  second.edges.reverse();
  for (const graph of [first, second]) {
    for (const node of graph.nodes) node.x = node.level * 100;
    applyFocusedFaninTreeBlockPlacement(graph.nodes, graph.edges, [1, 2, 3], {
      gap: 8,
      groupGap: 40,
      targetCenter: 100
    });
    applyRecursiveFocusedFaninTreePlacement(graph.nodes, graph.edges, [1, 2, 3], {
      gap: 8,
      siblingGap: 40,
      maximumShift: 32
    });
  }
  assert.deepEqual(
    new Map(first.nodes.map((node) => [node.id, node.y])),
    new Map(second.nodes.map((node) => [node.id, node.y]))
  );
});

test("fanin hierarchy keeps exclusive trees separate from shared bridges", () => {
  const { nodes, edges } = fixture();
  const hierarchy = buildFocusedFaninHierarchy(nodes, edges);
  assert.deepEqual(hierarchy.branches.map(({ rootId, nodeCount, leafCount }) =>
    ({ rootId, nodeCount, leafCount })), [
    { rootId: "a", nodeCount: 2, leafCount: 1 },
    { rootId: "b", nodeCount: 2, leafCount: 1 }
  ]);
  assert.deepEqual(hierarchy.sharedGroups.map(({ ownerIds, nodeCount }) =>
    ({ ownerIds, nodeCount })), [{ ownerIds: ["a", "b"], nodeCount: 1 }]);
});

test("tree-block placement makes every membership contiguous in each layer", () => {
  const { nodes, edges } = fixture();
  nodes.find((node) => node.id === "a-leaf").y = 0;
  nodes.find((node) => node.id === "b-leaf").y = 50;
  nodes.find((node) => node.id === "shared").y = 100;
  applyFocusedFaninTreeBlockPlacement(nodes, edges, [1, 2, 3], {
    gap: 8,
    groupGap: 40,
    targetCenter: 100
  });
  const summary = summarizeFocusedFaninTreeBlocks(nodes, edges);
  assert.equal(summary.fragmentedGroupCount, 0);
  assert.equal(summary.sharedNodeCount, 1);
});

test("tree-block placement is invariant to node and edge permutations", () => {
  const first = fixture();
  const second = fixture();
  second.nodes.reverse();
  second.edges.reverse();
  const options = { gap: 8, groupGap: 40, targetCenter: 100 };
  applyFocusedFaninTreeBlockPlacement(first.nodes, first.edges, [1, 2, 3], options);
  applyFocusedFaninTreeBlockPlacement(second.nodes, second.edges, [1, 2, 3], options);
  assert.deepEqual(
    new Map(first.nodes.map((node) => [node.id, node.y])),
    new Map(second.nodes.map((node) => [node.id, node.y]))
  );
});

test("fanin tree decomposition is invariant to input permutations", () => {
  const first = fixture();
  const second = fixture();
  second.nodes.reverse();
  second.edges.reverse();
  const project = (result) => result.entries.map(({ nodeId, ownerIds }) => [nodeId, ownerIds]);
  assert.deepEqual(
    project(buildFocusedFaninTreeBlocks(first.nodes, first.edges)),
    project(buildFocusedFaninTreeBlocks(second.nodes, second.edges))
  );
});

test("tree summary infers visual ranks when a provider omits logical levels", () => {
  const { nodes, edges } = fixture();
  for (const node of nodes) delete node.level;
  nodes.find((node) => node.id === "root").x = 300;
  for (const id of ["a", "b"]) nodes.find((node) => node.id === id).x = 200;
  for (const id of ["a-leaf", "shared", "b-leaf"]) {
    nodes.find((node) => node.id === id).x = 100;
  }
  const summary = summarizeFocusedFaninTreeBlocks(nodes, edges);
  assert.equal(summary.providerLevelsPresent, false);
  assert.equal(summary.visualRankCount, 2);
  assert.deepEqual(summary.levels.map((level) => level.nodeCount), [3, 2]);
});
