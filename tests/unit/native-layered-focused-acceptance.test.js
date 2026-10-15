import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildModuleWorkspace } from "../../src/app/moduleWorkspace.js";
import { summarizeFocusedFaninTreeBlocks } from "../../src/layout/layered/focusedTreeBlocks.js";
import { NativeLayeredLayoutProvider } from "../reference/retired_native_layered/native_layered_layout_provider.js";
import { parseVerilog } from "../../src/parser/verilogParser.js";

const source = await readFile(new URL("../fixtures/mapped/equal/eq_012_mapped.v", import.meta.url), "utf8");
const design = parseVerilog(source);
const module = design.modules.find((item) => item.name === "tc") || design.modules[0];

const sop015Source = await readFile(new URL("../fixtures/mapped/sop/sop_015_mapped.v", import.meta.url), "utf8");
const sop015Module = parseVerilog(sop015Source).modules[0];

test("native layered routes the eq012 clk focused net without hard violations", async () => {
  const graph = await BuildFocusedGraph({
    focusedRootNetIds: ["clk"],
    faninDepth: 1,
    fanoutDepth: 1
  });

  AssertRouted(graph);
  assert.equal(graph.layoutMetrics.phases.routing.rejectedNetCount, 0);
  assert.equal(graph.layoutMetrics.phases.routing.remainingOverlaps ?? 0, 0);
});

test("native layered preserves the eq012 _1471_ focused branch structure", async () => {
  const graph = await BuildFocusedGraph({
    focusedRootNodeIds: ["cell:_1471_"],
    faninDepth: 3,
    fanoutDepth: 3
  });
  const summary = summarizeFocusedFaninTreeBlocks(graph.nodes, graph.edges);

  AssertRouted(graph);
  assert.ok(graph.width <= 6600, `expected width <= 6600, received ${graph.width}`);
  assert.ok(graph.width * graph.height <= 210_000_000,
    `expected area <= 210000000, received ${graph.width * graph.height}`);
  assert.equal(summary.branchCount, 4);
  assert.equal(summary.hierarchy.sharedGroups.length, 2);
  assert.equal(summary.fragmentedGroupCount, 0);
});

test("native layered routes the sop015 _5426_ focused cone without hard violations", async () => {
  const graph = await BuildFocusedGraph({
    focusedRootNodeIds: ["cell:_5426_"],
    faninDepth: 3,
    fanoutDepth: 3
  }, sop015Module);

  AssertRouted(graph);
  const selectEdge = graph.edges.find((edge) => edge.source === "cell:_5404_" &&
    edge.target === "cell:_5426_" && edge.targetPin === "S");
  assert.ok(selectEdge, "expected _5404_ to drive the _5426_ S pin");
  const summary = summarizeFocusedFaninTreeBlocks(graph.nodes, graph.edges);
  assert.equal(summary.fragmentedGroupCount, 0,
    `expected no fragmented group, received ${summary.fragmentedGroupCount}`);
});

test("native layered separates the nested sop015 _5404_ input trees", async () => {
  const graph = await BuildFocusedGraph({
    focusedRootNodeIds: ["cell:_5426_"],
    faninDepth: 3,
    fanoutDepth: 3
  }, sop015Module);

  // Scenario-specific golden: these are the two non-overlapping input-tree
  // frontiers below _5404_. The provider implementation must discover the
  // separation from topology; it must not contain these instance names.
  const firstTree = ["cell:_5363_", "cell:_5364_", "cell:_5365_", "cell:_5369_"];
  const secondTree = ["cell:_5380_", "cell:_5389_", "cell:_5392_", "cell:_5402_"];
  const gap = VerticalGroupGap(graph.nodes, firstTree, secondTree);
  assert.ok(gap >= 96, `expected nested tree gap >= 96, received ${gap}`);
});

async function BuildFocusedGraph(focus, sourceModule = module) {
  return (await buildModuleWorkspace({
    module: sourceModule,
    viewMode: "focused",
    ...focus,
    useFanoutHubs: true,
    collapseLargeGroups: false,
    layoutProvider: new NativeLayeredLayoutProvider()
  })).graph;
}

function AssertRouted(graph) {
  assert.equal(graph.layoutStatus, "routed");
  assert.equal(graph.validationMetrics.total, 0);
  assert.equal(graph.edges.filter((edge) => !edge.points?.length).length, 0);
}

function VerticalGroupGap(nodes, firstIds, secondIds) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const first = firstIds.map((id) => byId.get(id)).filter(Boolean);
  const second = secondIds.map((id) => byId.get(id)).filter(Boolean);
  assert.equal(first.length, firstIds.length);
  assert.equal(second.length, secondIds.length);
  const firstTop = Math.min(...first.map((node) => Number(node.y)));
  const firstBottom = Math.max(...first.map((node) => Number(node.y) + Number(node.height)));
  const secondTop = Math.min(...second.map((node) => Number(node.y)));
  const secondBottom = Math.max(...second.map((node) => Number(node.y) + Number(node.height)));
  return Math.max(secondTop - firstBottom, firstTop - secondBottom);
}
