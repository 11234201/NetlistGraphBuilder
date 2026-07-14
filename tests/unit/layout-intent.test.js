import assert from "node:assert/strict";
import test from "node:test";
import { analyzeLayoutIntent, compareEdgesByLayoutPriority } from "../../src/layout/layoutIntent.js";

test("layout intent marks a single-load net as the highest routing priority", () => {
  const graph = {
    nodes: [
      { id: "s", kind: "cell" },
      { id: "t", kind: "cell" },
      { id: "f", kind: "cell" },
      { id: "a", kind: "cell" },
      { id: "b", kind: "cell" }
    ],
    edges: [
      { id: "single", source: "s", target: "t", net: "single" },
      { id: "fan-a", source: "f", target: "a", net: "fan" },
      { id: "fan-b", source: "f", target: "b", net: "fan" }
    ]
  };
  const levels = new Map([["s", 1], ["t", 2], ["f", 1], ["a", 2], ["b", 3]]);
  const intent = analyzeLayoutIntent(graph, levels);
  const sorted = graph.edges.toSorted((left, right) => compareEdgesByLayoutPriority(left, right, intent));

  assert.equal(intent.getEdge("single").fanout, 1);
  assert.equal(sorted[0].id, "single");
});

test("multi-load intent chooses the shallowest cell target as its primary branch", () => {
  const graph = {
    nodes: [
      { id: "driver", kind: "cell" },
      { id: "shallow-output", kind: "output" },
      { id: "shallow-cell", kind: "cell" },
      { id: "deep-cell", kind: "cell" }
    ],
    edges: [
      { id: "out", source: "driver", target: "shallow-output", net: "n" },
      { id: "cell", source: "driver", target: "shallow-cell", net: "n" },
      { id: "deep", source: "driver", target: "deep-cell", net: "n" }
    ]
  };
  const levels = new Map([
    ["driver", 1], ["shallow-output", 2], ["shallow-cell", 2], ["deep-cell", 4]
  ]);
  const intent = analyzeLayoutIntent(graph, levels);

  assert.equal(intent.getEdge("cell").isPrimary, true);
  assert.equal(intent.getEdge("cell").rank, 0);
  assert.equal(intent.getEdge("deep").isPrimary, false);
  assert.equal(intent.getBoundaryPressure(1), 3);
});
