import { readFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { parseVerilog } from "../src/parser/verilogParser.js";
import { buildWorkspaceGraph, applyWorkspaceGraphTransforms } from "../src/app/graphWorkspace.js";
import { measureDiagramGraph } from "../src/diagram/measure_graph.js";
import { layoutGraph } from "../src/layout/simpleLayered.js";

const netlist = process.argv[2];
if (!netlist) throw new Error("Usage: node tools/profile-mapped-pipeline.mjs <mapped.v>");

let checkpoint = performance.now();
function report(stage, detail = null) {
  const current = performance.now();
  process.stderr.write(`${JSON.stringify({
    stage,
    deltaMs: round(current - checkpoint),
    elapsedMs: round(current - startedAt),
    ...(detail ? { detail } : {})
  })}\n`);
  checkpoint = current;
}

const startedAt = performance.now();
const source = await readFile(netlist, "utf8");
report("read");
const design = parseVerilog(source);
const module = design.modules.find((item) => item.name === "tc") ?? design.modules[0];
report("parse", { cells: module?.cells.length || 0 });
const fullGraph = buildWorkspaceGraph(module, {
  moduleLibrary: design.modules,
  showAliases: false
});
report("graph", { nodes: fullGraph.nodes.length, edges: fullGraph.edges.length });
const projected = applyWorkspaceGraphTransforms(fullGraph, {
  useFanoutHubs: false,
  collapseLargeGroups: false
});
report("project");
const measured = measureDiagramGraph(projected);
report("measure");
const positioned = layoutGraph(measured, {
  onLayoutStage: (stage, detail) => report(stage, detail),
  onPlacementStage: (stage) => report(`placement:${stage}`),
  onRoutingProgress: (progress) => report("routing-progress", {
    completedEdges: progress.completedEdges,
    totalEdges: progress.totalEdges,
    reservedSegments: progress.reservedSegments
  }),
  onRoutingStage: (stage) => report(`routing:${stage}`),
  onRoutingGroup: (detail) => report("routing-group", detail),
  onRoutingEdge: (detail) => {
    if (detail.edgeIndex >= 3500) report("routing-edge", detail);
  }
});
report("complete", {
  layoutStatus: positioned.layoutStatus,
  violations: positioned.validationMetrics?.total || 0
});

function round(value) {
  return Math.round(value * 10) / 10;
}
