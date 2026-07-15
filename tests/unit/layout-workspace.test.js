import assert from "node:assert/strict";
import test from "node:test";
import {
  applyWorkspaceOverrides,
  layoutWorkspaceGraph
} from "../../src/app/layoutWorkspace.js";

const graph = {
  nodes: [{ id: "n", kind: "input", x: 0, y: 0, width: 40, height: 20, ports: [] }],
  edges: [],
  width: 40,
  height: 20
};

test("layout workspace keeps automatic and adjusted graphs separate", () => {
  const provider = { layout: (value) => structuredClone(value) };
  const result = layoutWorkspaceGraph(graph, {
    layoutProvider: provider,
    nodePositions: new Map([["n", { x: 120, y: 80 }]])
  });

  assert.deepEqual({ x: result.autoGraph.nodes[0].x, y: result.autoGraph.nodes[0].y }, { x: 0, y: 0 });
  assert.deepEqual({ x: result.graph.nodes[0].x, y: result.graph.nodes[0].y }, { x: 120, y: 80 });
});

test("layout workspace preserves asynchronous providers", async () => {
  const provider = { layout: async (value) => structuredClone(value) };
  const result = layoutWorkspaceGraph(graph, { layoutProvider: provider });
  assert.equal(typeof result.then, "function");
  const resolved = await result;
  assert.equal(resolved.graph, resolved.autoGraph);
});

test("cached workspace overrides never rerun the layout provider", () => {
  let providerCalls = 0;
  const provider = {
    layout(value) {
      providerCalls += 1;
      return structuredClone(value);
    }
  };
  const result = layoutWorkspaceGraph(graph, { layoutProvider: provider });

  const adjusted = applyWorkspaceOverrides(result.autoGraph, {
    nodePositions: new Map([["n", { x: 160, y: 90 }]])
  });

  assert.equal(providerCalls, 1);
  assert.deepEqual({ x: adjusted.nodes[0].x, y: adjusted.nodes[0].y }, { x: 160, y: 90 });
});
