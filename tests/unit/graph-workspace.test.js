import assert from "node:assert/strict";
import test from "node:test";
import {
  applyWorkspaceGraphTransforms,
  buildWorkspaceGraph,
  selectWorkspaceGraphView,
  shouldUseSearchFirst
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

test("large module policy enters search-first only above its stable threshold", () => {
  assert.equal(shouldUseSearchFirst({ cells: Array.from({ length: 500 }) }), false);
  assert.equal(shouldUseSearchFirst({ cells: Array.from({ length: 501 }) }), true);
  assert.equal(shouldUseSearchFirst({ nodes: Array.from({ length: 1024 }) }, 500), true);
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

test("search-first and focused views derive from the full graph without mutation", () => {
  const module = parseVerilog(source).modules[0];
  const fullGraph = buildWorkspaceGraph(module, { moduleLibrary: [module] });
  const empty = selectWorkspaceGraphView(fullGraph, { viewMode: "search-first" });
  const focused = selectWorkspaceGraphView(fullGraph, {
    viewMode: "focused",
    rootNodeId: "cell:u0",
    faninDepth: 1,
    fanoutDepth: 1
  });
  assert.equal(empty.nodes.length, 0);
  assert.equal(empty.view.totalNodes, fullGraph.nodes.length);
  assert.ok(focused.nodes.some((node) => node.id === "cell:u0"));
  assert.equal(fullGraph.view, undefined);
  assert.ok(fullGraph.nodes.length > focused.nodes.length);
});
