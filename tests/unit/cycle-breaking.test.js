import assert from "node:assert/strict";
import test from "node:test";
import {
  orientCyclesForLayering,
  restoreOrientedEdge
} from "../../src/layout/layered/cycle_breaking.js";

test("cycle orientation is acyclic, reversible, and permutation stable", () => {
  const graph = {
    nodes: ["a", "b", "c", "d"].map((id) => ({ id, kind: "cell", label: id })),
    edges: [
      { id: "ab", source: "a", target: "b", sourcePin: "Y", targetPin: "A" },
      { id: "bc", source: "b", target: "c", sourcePin: "Y", targetPin: "A" },
      { id: "ca", source: "c", target: "a", sourcePin: "Y", targetPin: "A" },
      { id: "cd", source: "c", target: "d", sourcePin: "Y", targetPin: "A" }
    ]
  };

  const forward = orientCyclesForLayering(graph);
  const reversed = orientCyclesForLayering({
    nodes: graph.nodes.toReversed(),
    edges: graph.edges.toReversed()
  });

  assert.equal(hasDirectedCycle(forward.edges.filter((edge) => !edge.ignoredForLayering)), false);
  assert.deepEqual(reversed.edges, forward.edges);
  assert.deepEqual(forward.reversedEdgeIds, ["ca"]);
  assert.deepEqual(
    forward.edges.map(restoreOrientedEdge),
    graph.edges.toSorted((left, right) => left.id.localeCompare(right.id))
  );
});

test("an acyclic edge is not reversed merely because its ids sort backwards", () => {
  const result = orientCyclesForLayering({
    nodes: [
      { id: "z", kind: "cell", label: "z" },
      { id: "a", kind: "cell", label: "a" }
    ],
    edges: [{ id: "za", source: "z", target: "a" }]
  });
  assert.equal(result.edges[0].reversedForLayout, false);
  assert.equal(result.edges[0].source, "z");
});

test("self loops are retained for routing but excluded from layering", () => {
  const result = orientCyclesForLayering({
    nodes: [{ id: "a", kind: "cell", label: "a" }],
    edges: [{ id: "aa", source: "a", target: "a" }]
  });
  assert.deepEqual(result.selfLoopEdgeIds, ["aa"]);
  assert.equal(result.edges[0].ignoredForLayering, true);
  assert.deepEqual(restoreOrientedEdge(result.edges[0]), { id: "aa", source: "a", target: "a" });
});

function hasDirectedCycle(edges) {
  const outgoing = new Map();
  const indegree = new Map();
  for (const edge of edges) {
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    outgoing.get(edge.source).push(edge.target);
    indegree.set(edge.source, indegree.get(edge.source) || 0);
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
  }
  const queue = [...indegree].filter(([, degree]) => degree === 0).map(([id]) => id).sort();
  let visited = 0;
  while (queue.length > 0) {
    const nodeId = queue.shift();
    visited += 1;
    for (const target of outgoing.get(nodeId) || []) {
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  return visited !== indegree.size;
}
