import assert from "node:assert/strict";
import test from "node:test";
import { BuildCanonicalGraph } from "../reference/retired_native_layered/canonical_graph.js";
import { BreakCycles, RestoreLayoutEdge } from "../reference/retired_native_layered/cycle_breaking.js";
import { AssignRanks } from "../reference/retired_native_layered/rank_assignment.js";

test("cycle breaking is acyclic, reversible, and permutation stable", () => {
  const graph = MakeCycleGraph();
  const first = Run(graph);
  const second = Run({ nodes: graph.nodes.toReversed(), edges: graph.edges.toReversed() });
  assert.deepEqual(Summarize(second), Summarize(first));
  assert.equal(HasCycle(first.orientation), false);
  for (const edge of first.orientation.edges) {
    assert.deepEqual(RestoreLayoutEdge(edge), {
      sourceKey: edge.sourceKey,
      targetKey: edge.targetKey,
      sourcePortKey: edge.sourcePortKey,
      targetPortKey: edge.targetPortKey,
      sourcePin: edge.sourcePin,
      targetPin: edge.targetPin
    });
  }
});

test("rank assignment respects every minimum length and anchors primary ports", () => {
  const model = BuildCanonicalGraph({
    nodes: [
      { id: "in", kind: "input", label: "in" },
      { id: "a", kind: "cell", label: "a" },
      { id: "b", kind: "cell", label: "b" },
      { id: "out", kind: "output", label: "out" }
    ],
    edges: [
      { id: "ia", source: "in", target: "a", minimumLength: 2 },
      { id: "ab", source: "a", target: "b" },
      { id: "bo", source: "b", target: "out" }
    ]
  });
  const orientation = BreakCycles(model);
  const ranking = AssignRanks(model, orientation);
  for (const edge of orientation.edges) {
    assert.ok(ranking.ranks.get(edge.layoutTargetKey) - ranking.ranks.get(edge.layoutSourceKey) >= edge.minimumLength);
  }
  assert.equal(ranking.ranks.get("in"), 0);
});

function Run(graph) {
  const model = BuildCanonicalGraph(graph);
  const orientation = BreakCycles(model);
  return { orientation, ranking: AssignRanks(model, orientation) };
}

function MakeCycleGraph() {
  return {
    nodes: ["a", "b", "c", "d"].map((id) => ({ id, kind: "cell", label: id })),
    edges: [
      { id: "ab", source: "a", target: "b" },
      { id: "bc", source: "b", target: "c" },
      { id: "ca", source: "c", target: "a" },
      { id: "cd", source: "c", target: "d" }
    ]
  };
}

function Summarize(result) {
  return {
    edges: result.orientation.edges,
    reversed: result.orientation.reversedEdgeKeys,
    ranks: [...result.ranking.ranks].sort()
  };
}

function HasCycle(orientation) {
  const edges = orientation.edges.filter((edge) => !edge.ignoredForLayering);
  const keys = new Set(edges.flatMap((edge) => [edge.layoutSourceKey, edge.layoutTargetKey]));
  const indegree = new Map([...keys].map((key) => [key, 0]));
  const outgoing = new Map([...keys].map((key) => [key, []]));
  for (const edge of edges) {
    outgoing.get(edge.layoutSourceKey).push(edge.layoutTargetKey);
    indegree.set(edge.layoutTargetKey, indegree.get(edge.layoutTargetKey) + 1);
  }
  const queue = [...keys].filter((key) => indegree.get(key) === 0);
  let visited = 0;
  while (queue.length > 0) {
    const key = queue.pop();
    visited += 1;
    for (const target of outgoing.get(key)) {
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  return visited !== keys.size;
}
