import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { buildSchematicGraph } from "../src/netlist/graph.js";
import { ElkLayoutProvider } from "../src/layout/elkLayoutProvider.js";
import { analyzeLayoutQuality } from "../src/layout/layoutQuality.js";
import { SimpleLayeredLayoutProvider } from "../src/layout/layoutProvider.js";
import { validateLayoutGraph } from "../src/layout/layoutValidator.js";
import { parseVerilog } from "../src/parser/verilogParser.js";
import Elk from "../vendor/elkjs-0.11.1/lib/elk.bundled.js";

const fixture = process.argv[2] || "tests/fixtures/mapped/equal/eq_012_mapped.v";
const source = await readFile(fixture, "utf8");
const design = parseVerilog(source);
const module = design.modules.find((item) => item.name === "tc") || design.modules[0];
if (!module) throw new Error("No Verilog module found");
const sourceGraph = buildSchematicGraph(module, { moduleLibrary: design.modules });
const providers = [
  new SimpleLayeredLayoutProvider(),
  new ElkLayoutProvider({ elkFactory: () => new Elk() })
];
const reports = [];

for (const provider of providers) {
  console.error(`[${provider.id}] layout start`);
  const startedAt = performance.now();
  const graph = await provider.layout(sourceGraph);
  const elapsedMs = performance.now() - startedAt;
  console.error(`[${provider.id}] layout ${round(elapsedMs)} ms`);
  const validationStartedAt = performance.now();
  const violations = validateLayoutGraph(graph, { checkBounds: true });
  const validationMs = performance.now() - validationStartedAt;
  console.error(`[${provider.id}] validation ${round(validationMs)} ms`);
  const missing = graph.edges.filter((edge) =>
    edge.routeKind === "unroutable" ||
    edge.routeStatus === "unroutable" ||
    !Array.isArray(edge.points) || edge.points.length < 2
  );
  const qualityStartedAt = performance.now();
  const quality = analyzeLayoutQuality(graph);
  const qualityMs = performance.now() - qualityStartedAt;
  console.error(`[${provider.id}] quality ${round(qualityMs)} ms`);
  reports.push({
    provider: provider.id,
    elapsedMs: round(elapsedMs),
    validationMs: round(validationMs),
    qualityMs: round(qualityMs),
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    width: round(graph.width),
    height: round(graph.height),
    area: round(graph.width * graph.height),
    layoutStatus: graph.layoutStatus,
    missingRoutes: missing.length,
    violations: violations.length,
    violationCodes: countCodes(violations),
    routingElapsedMs: round(graph.routingMetrics?.elapsedMs || 0),
    routingMetrics: summarizeRoutingMetrics(graph.routingMetrics),
    physicalCrossings: quality.physicalCrossingCount,
    physicalOverlaps: quality.physicalOverlapCount,
    averageLength: quality.averageLength,
    averageBends: quality.averageBends,
    outerRouteRatio: quality.outerRouteRatio
  });
}

console.log(JSON.stringify({ fixture, module: module.name, reports }, null, 2));

function countCodes(items) {
  const counts = {};
  for (const item of items) {
    const code = item.code || "unknown";
    counts[code] = (counts[code] || 0) + 1;
  }
  return counts;
}

function summarizeRoutingMetrics(metrics) {
  if (!metrics) return null;
  return {
    basicCandidates: metrics.basicCandidates || 0,
    localFallbacks: metrics.localFallbacks || 0,
    localCandidates: metrics.localCandidates || 0,
    globalFallbacks: metrics.globalFallbacks || 0,
    physicalNetCount: metrics.physicalNetCount || 0,
    unroutablePhysicalNetCount: metrics.unroutablePhysicalNetCount || 0,
    routeKinds: metrics.routeKinds || {},
    physicalNetTrialRejectCounts: metrics.physicalNetTrialRejectCounts || {},
    reservedSegments: metrics.reservedSegments || null,
    capacity: metrics.capacity || null
  };
}

function round(value) {
  return Math.round(Number(value) * 1000) / 1000;
}
