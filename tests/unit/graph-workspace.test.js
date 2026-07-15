import assert from "node:assert/strict";
import test from "node:test";
import {
  applyWorkspaceGraphTransforms,
  buildWorkspaceGraph,
  selectWorkspaceGraphView
} from "../../src/app/graphWorkspace.js";
import { parseVerilog } from "../../src/parser/verilogParser.js";

const source = `module top (a, y0, y1); input a; output y0, y1;
BUF u0 (.A(a), .Y(y0)); BUF u1 (.A(a), .Y(y1)); endmodule`;

test("shared graph workspace prepares whole and cone views without mutation", () => {
  const module = parseVerilog(source).modules[0];
  const fullGraph = buildWorkspaceGraph(module, { moduleLibrary: [module] });
  const cone = selectWorkspaceGraphView(fullGraph, {
    viewMode: "fanin",
    rootNodeId: "output:y0",
    maxDepth: 3
  });

  assert.ok(fullGraph.nodes.some((node) => node.id === "cell:u1"));
  assert.equal(cone.nodes.some((node) => node.id === "cell:u1"), false);
  assert.ok(cone.nodes.some((node) => node.id === "cell:u0"));
});

test("shared display transforms can be disabled independently", () => {
  const module = parseVerilog(source).modules[0];
  const graph = buildWorkspaceGraph(module, { moduleLibrary: [module] });
  const unchanged = applyWorkspaceGraphTransforms(graph, {
    useFanoutHubs: false,
    collapseLargeGroups: false
  });
  const simplified = applyWorkspaceGraphTransforms(graph, {
    useFanoutHubs: true,
    collapseLargeGroups: false
  });

  assert.equal(unchanged, graph);
  assert.ok(simplified.nodes.length >= graph.nodes.length);
});
