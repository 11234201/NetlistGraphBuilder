import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { applyWorkspaceGraphTransforms } from "../src/app/graphWorkspace.js";
import { getLayoutProvider } from "../src/layout/layoutProvider.js";
import { validateLayoutGraph } from "../src/layout/layoutValidator.js";
import { buildSchematicGraph } from "../src/netlist/graph.js";
import { parseVerilog } from "../src/parser/verilogParser.js";

const input = process.argv[2];
const noCollapse = process.argv.includes("--no-collapse");
const hardInvariants = process.argv.includes("--hard") || process.env.MAPPED_HARD_INVARIANTS === "1";
const providerId = process.env.MAPPED_CASE_PROVIDER || "simple-layered";
if (!input) throw new Error("usage: node tools/test-one-mapped-case.mjs <netlist.v> [--no-collapse] [--hard]");

const source = await readFile(input, "utf8");
const parseStarted = performance.now();
console.error("stage=parse");
const design = parseVerilog(source);
const parseMs = performance.now() - parseStarted;
const module = design.modules.find((item) => item.name === "tc") ?? design.modules[0];
if (!module) throw new Error(`No Verilog module found in ${input}`);

const graphStarted = performance.now();
console.error("stage=graph");
const rawGraph = buildSchematicGraph(module);
const graph = applyWorkspaceGraphTransforms(rawGraph, {
  collapseLargeGroups: !noCollapse
});
const graphMs = performance.now() - graphStarted;
const layoutStarted = performance.now();
console.error("stage=layout");
// Research-only candidate selection does not register a second UI provider.
const provider = providerId === "elk-native-candidate"
  ? new (await import("../src/layout/elk_native_layout_provider.js")).NativeLayeredLayoutProvider()
  : getLayoutProvider(providerId);
const laidOut = await provider.layout(graph, {
  strictRouting: hardInvariants
});
const layoutMs = performance.now() - layoutStarted;
console.error("stage=validate");
const violations = validateLayoutGraph(laidOut, {
  checkObstacles: true,
  checkOverlaps: hardInvariants,
  checkBounds: true,
  maxViolations: 256
});
const routedEdges = laidOut.edges.filter((edge) => edge.points?.length >= 2).length;
const edgeById = new Map(laidOut.edges.map((edge) => [String(edge.id), edge]));

console.log(JSON.stringify({
  input,
  providerId,
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
  hardInvariants,
  layoutStatus: laidOut.layoutStatus || "unknown",
  layoutMetrics: laidOut.layoutMetrics || null,
  routingMetrics: laidOut.routingMetrics || null,
  validationMetrics: laidOut.validationMetrics || null,
  violations: violations.length,
  violationCodes: countBy(violations, (item) => item.code),
  violationSamples: violations.slice(0, 12).map((violation) => ({
    ...violation,
    edgePoints: edgeById.get(String(violation.edgeId))?.points || null,
    otherEdgePoints: edgeById.get(String(violation.otherEdgeId))?.points || null
  })),
  providerDiagnosticCodes: countBy(laidOut.providerDiagnostics || [], (item) => item.code || "unknown"),
  providerDiagnosticSamples: diagnosticSamples(laidOut.providerDiagnostics || [], 12)
}));

function countBy(items, keyFor) {
  const counts = {};
  for (const item of items) {
    const key = keyFor(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function diagnosticSamples(items, limit) {
  const selected = [];
  const seenCodes = new Set();
  for (const item of items) {
    const code = item?.code || "unknown";
    if (seenCodes.has(code)) continue;
    selected.push(item);
    seenCodes.add(code);
    if (selected.length >= limit) return selected;
  }
  for (const item of items) {
    if (selected.includes(item)) continue;
    selected.push(item);
    if (selected.length >= limit) break;
  }
  return selected;
}
