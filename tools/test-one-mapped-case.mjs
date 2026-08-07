import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { applyWorkspaceGraphTransforms } from "../src/app/graphWorkspace.js";
import { getLayoutProvider } from "../src/layout/layoutProvider.js";
import { validateLayoutGraph } from "../src/layout/layoutValidator.js";
import { buildSchematicGraph } from "../src/netlist/graph.js";
import { parseVerilog } from "../src/parser/verilogParser.js";

const input = process.argv[2];
if (!input) throw new Error("usage: node tools/test-one-mapped-case.mjs <netlist.v>");

const source = await readFile(input, "utf8");
const parseStarted = performance.now();
const design = parseVerilog(source);
const parseMs = performance.now() - parseStarted;
const module = design.modules.find((item) => item.name === "tc") ?? design.modules[0];
if (!module) throw new Error(`No Verilog module found in ${input}`);

const graphStarted = performance.now();
const rawGraph = buildSchematicGraph(module);
const graph = applyWorkspaceGraphTransforms(rawGraph);
const graphMs = performance.now() - graphStarted;
const layoutStarted = performance.now();
const laidOut = getLayoutProvider().layout(graph);
const layoutMs = performance.now() - layoutStarted;
const violations = validateLayoutGraph(laidOut, { checkOverlaps: false });
const routedEdges = laidOut.edges.filter((edge) => edge.routeKind).length;

console.log(JSON.stringify({
  input,
  bytes: Buffer.byteLength(source),
  cells: module.cells.length,
  rawNodes: rawGraph.nodes.length,
  rawEdges: rawGraph.edges.length,
  nodes: graph.nodes.length,
  edges: graph.edges.length,
  routedEdges,
  parseMs: Math.round(parseMs),
  graphMs: Math.round(graphMs),
  layoutMs: Math.round(layoutMs),
  heapUsedMiB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  violations: violations.length,
  violationCodes: countBy(violations, (item) => item.code)
}));

function countBy(items, keyFor) {
  const counts = {};
  for (const item of items) {
    const key = keyFor(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}
