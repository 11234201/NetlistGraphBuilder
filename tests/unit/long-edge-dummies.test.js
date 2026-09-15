import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLayoutPolicy } from "../../src/layout/layoutPolicy.js";
import {
  DUMMY_NODE_KIND,
  addDummyNodesToBuckets,
  buildLongEdgeChains,
  isDummyNode,
  normalizeLongEdgeDummyPolicy,
  stripDummyNodes,
  summarizeLongEdgeChains
} from "../../src/layout/layered/longEdgeDummies.js";
import { orderSimpleLayers } from "../../src/layout/simpleLayering.js";

test("splitting a long edge produces only unit-span segments", () => {
  const graph = {
    nodes: [
      { id: "a", label: "a", kind: "cell" },
      { id: "m", label: "m", kind: "cell" },
      { id: "z", label: "z", kind: "cell" }
    ],
    edges: [{ id: "a-z", source: "a", target: "z" }]
  };
  const levels = new Map([["a", 0], ["m", 1], ["z", 2]]);

  const chains = buildLongEdgeChains(graph, levels);

  assert.equal(chains.dummies.length, 1);
  assert.equal(chains.dummies[0].level, 1);
  assert.deepEqual(
    chains.orderingEdges.map((edge) => `${edge.source}->${edge.target}`),
    ["a->dummy:a-z:1", "dummy:a-z:1->z"]
  );
  assert.deepEqual(summarizeLongEdgeChains(chains).spanHistogram, [[2, 1]]);
});

test("every segment spans exactly one column", () => {
  const graph = {
    nodes: [
      { id: "a", label: "a", kind: "cell" },
      { id: "b", label: "b", kind: "cell" },
      { id: "c", label: "c", kind: "cell" },
      { id: "d", label: "d", kind: "cell" },
      { id: "e", label: "e", kind: "cell" }
    ],
    edges: [
      { id: "a-e", source: "a", target: "e" },
      { id: "b-d", source: "b", target: "d" },
      { id: "d-e", source: "d", target: "e" }
    ]
  };
  const levels = new Map([["a", 0], ["b", 0], ["c", 2], ["d", 3], ["e", 4]]);

  const chains = buildLongEdgeChains(graph, levels);
  const columnOf = new Map();
  for (const [nodeId, level] of levels) columnOf.set(nodeId, level);
  for (const dummy of chains.dummies) columnOf.set(dummy.id, dummy.level);
  const columns = [...new Set(columnOf.values())].sort((left, right) => left - right);
  const indexOf = new Map(columns.map((level, index) => [level, index]));

  for (const edge of chains.orderingEdges) {
    const span = indexOf.get(columnOf.get(edge.target)) - indexOf.get(columnOf.get(edge.source));
    assert.equal(span, 1, `${edge.id} spans ${span} columns`);
  }
});

test("dummy ids do not depend on the order of the edge array", () => {
  const graph = {
    nodes: [
      { id: "a", label: "a", kind: "cell" },
      { id: "m", label: "m", kind: "cell" },
      { id: "z", label: "z", kind: "cell" }
    ],
    edges: [
      { id: "e1", source: "a", target: "z" },
      { id: "e2", source: "a", target: "z" }
    ]
  };
  const levels = new Map([["a", 0], ["m", 1], ["z", 2]]);

  const forward = buildLongEdgeChains(graph, levels);
  const reversed = buildLongEdgeChains(
    { nodes: graph.nodes.toReversed(), edges: graph.edges.toReversed() },
    levels
  );

  assert.deepEqual(
    reversed.dummies.map((dummy) => dummy.id).sort(),
    forward.dummies.map((dummy) => dummy.id).sort()
  );
});

test("a back edge is left to the router instead of being split", () => {
  const graph = {
    nodes: [
      { id: "a", label: "a", kind: "cell" },
      { id: "b", label: "b", kind: "cell" }
    ],
    edges: [{ id: "b-a", source: "b", target: "a" }]
  };
  const levels = new Map([["a", 0], ["b", 1]]);

  const chains = buildLongEdgeChains(graph, levels);

  assert.equal(chains.dummies.length, 0);
  assert.deepEqual(chains.orderingEdges.map((edge) => edge.id), ["b-a"]);
});

test("an edge with a missing projected endpoint remains visible to diagnostics", () => {
  const graph = {
    nodes: [{ id: "a", label: "a", kind: "cell" }],
    edges: [{ id: "a-missing", source: "a", target: "missing" }]
  };

  const chains = buildLongEdgeChains(graph, new Map([["a", 0]]));

  assert.deepEqual(chains.orderingEdges.map((edge) => edge.id), ["a-missing"]);
  assert.equal(chains.dummies.length, 0);
});

test("the dummy cap emits a diagnostic and leaves the edge unsplit", () => {
  const graph = {
    nodes: [
      { id: "a", label: "a", kind: "cell" },
      { id: "m", label: "m", kind: "cell" },
      { id: "z", label: "z", kind: "cell" }
    ],
    edges: [
      { id: "e1", source: "a", target: "z" },
      { id: "e2", source: "a", target: "z" }
    ]
  };
  const levels = new Map([["a", 0], ["m", 1], ["z", 2]]);

  const chains = buildLongEdgeChains(graph, levels, { maxDummyNodes: 1 });

  assert.equal(chains.dummies.length, 1);
  assert.deepEqual(chains.diagnostics.map((entry) => entry.code), ["layered-dummy-cap-exceeded"]);
  // The edge that did not fit stays whole; it is never half split.
  assert.ok(chains.orderingEdges.some((edge) => edge.id === "e1" || edge.id === "e2"));
  assert.equal(chains.chainsByEdge.size, 1);
});

test("stripping dummies restores the buckets and records the vertical anchors", () => {
  const graph = {
    nodes: [
      { id: "a", label: "a", kind: "cell" },
      { id: "m1", label: "m1", kind: "cell" },
      { id: "m2", label: "m2", kind: "cell" },
      { id: "z", label: "z", kind: "cell" }
    ],
    edges: [{ id: "a-z", source: "a", target: "z" }]
  };
  const levels = new Map([["a", 0], ["m1", 1], ["m2", 1], ["z", 2]]);
  const chains = buildLongEdgeChains(graph, levels);
  const buckets = new Map();
  for (const node of graph.nodes) {
    if (!buckets.has(levels.get(node.id))) buckets.set(levels.get(node.id), []);
    buckets.get(levels.get(node.id)).push(node);
  }

  addDummyNodesToBuckets(buckets, chains);
  orderSimpleLayers(buckets, [0, 1, 2], chains.orderingEdges);
  const anchors = stripDummyNodes(buckets, chains);

  for (const level of buckets.keys()) {
    assert.ok(
      (buckets.get(level) || []).every((node) => !isDummyNode(node)),
      `level ${level} still holds a dummy`
    );
  }
  assert.equal(anchors.size, 1);
  const anchor = anchors.get("dummy:a-z:1");
  assert.equal(anchor.level, 1);
  assert.ok(anchor.aboveId === null || anchor.aboveId === "m1" || anchor.aboveId === "m2");
  assert.ok(anchor.belowId === null || anchor.belowId === "m1" || anchor.belowId === "m2");
});

test("stripping a dense dummy run records nearest real anchors in linear passes", () => {
  const above = { id: "above", kind: "cell" };
  const below = { id: "below", kind: "cell" };
  const first = { id: "dummy:e1:1", kind: DUMMY_NODE_KIND, level: 1, column: 1, realEdgeId: "e1" };
  const second = { id: "dummy:e2:1", kind: DUMMY_NODE_KIND, level: 1, column: 1, realEdgeId: "e2" };
  const buckets = new Map([[1, [above, first, second, below]]]);
  const chains = { levelKeys: [1] };

  const anchors = stripDummyNodes(buckets, chains);

  assert.deepEqual(buckets.get(1).map((node) => node.id), ["above", "below"]);
  assert.deepEqual(anchors.get(first.id), {
    level: 1,
    column: 1,
    aboveId: "above",
    belowId: "below",
    realEdgeId: "e1"
  });
  assert.deepEqual(anchors.get(second.id), {
    level: 1,
    column: 1,
    aboveId: "above",
    belowId: "below",
    realEdgeId: "e2"
  });
});

test("a graph without long edges orders identically with and without dummies", () => {
  const graph = {
    nodes: [
      { id: "a", label: "a", kind: "cell" },
      { id: "b", label: "b", kind: "cell" },
      { id: "c", label: "c", kind: "cell" }
    ],
    edges: [
      { id: "a-b", source: "a", target: "b" },
      { id: "b-c", source: "b", target: "c" }
    ]
  };
  const levels = new Map([["a", 0], ["b", 1], ["c", 2]]);

  const plain = orderWithDummies(graph, levels, false);
  const withDummies = orderWithDummies(graph, levels, true);

  assert.deepEqual(withDummies, plain);
  assert.equal(withDummies.get(1).length, 1);
});

test("the layout policy keeps long-edge dummies off until routing can place them", () => {
  const policy = normalizeLayoutPolicy();
  assert.equal(policy.features.longEdgeDummies, false);
  assert.equal(policy.layering.maxDummyNodes, 40000);

  const enabled = normalizeLayoutPolicy({ features: { longEdgeDummies: true } });
  assert.equal(enabled.features.longEdgeDummies, true);

  const clamped = normalizeLayoutPolicy({ layering: { maxDummyNodes: -5 } });
  assert.equal(clamped.layering.maxDummyNodes, 0);
  assert.equal(normalizeLongEdgeDummyPolicy({}).maxDummyNodes, 40000);
});

function orderWithDummies(graph, levels, useDummies) {
  const buckets = new Map();
  for (const node of graph.nodes) {
    const level = levels.get(node.id);
    if (!buckets.has(level)) buckets.set(level, []);
    buckets.get(level).push(node);
  }
  const levelKeys = [...buckets.keys()].sort((left, right) => left - right);
  let edges = graph.edges;
  if (useDummies) {
    const chains = buildLongEdgeChains(graph, levels);
    addDummyNodesToBuckets(buckets, chains);
    edges = chains.orderingEdges;
  }
  orderSimpleLayers(buckets, levelKeys, edges);
  const result = new Map();
  for (const level of levelKeys) {
    result.set(level, (buckets.get(level) || [])
      .filter((node) => !isDummyNode(node))
      .map((node) => node.id));
  }
  return result;
}

test("DUMMY_NODE_KIND is the only way a dummy is recognised", () => {
  assert.equal(isDummyNode({ kind: DUMMY_NODE_KIND }), true);
  assert.equal(isDummyNode({ kind: "cell" }), false);
  assert.equal(isDummyNode(null), false);
});
