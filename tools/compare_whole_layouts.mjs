import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { buildSchematicGraph } from "../src/netlist/graph.js";
import { ElkLayoutProvider } from "../src/layout/elkLayoutProvider.js";
import { analyzeLayoutQuality } from "../src/layout/layoutQuality.js";
import { SimpleLayeredLayoutProvider } from "../src/layout/layoutProvider.js";
import { validateLayoutGraph } from "../src/layout/layoutValidator.js";
import { getNetGroupKey } from "../src/layout/layoutTopology.js";
import { parseVerilog } from "../src/parser/verilogParser.js";
import Elk from "../vendor/elkjs-0.11.1/lib/elk.bundled.js";

const fixture = process.argv[2] || "tests/fixtures/mapped/equal/eq_012_mapped.v";
const source = await readFile(fixture, "utf8");
const design = parseVerilog(source);
const module = design.modules.find((item) => item.name === "tc") || design.modules[0];
if (!module) throw new Error("No Verilog module found");
const sourceGraph = buildSchematicGraph(module, { moduleLibrary: design.modules });
const requestedProvider = process.env.LAYOUT_PROVIDER;
const providers = [
  new SimpleLayeredLayoutProvider(),
  new ElkLayoutProvider({ elkFactory: () => new Elk() })
].filter((provider) => !requestedProvider || provider.id === requestedProvider);
if (providers.length === 0) {
  throw new Error(`Unknown LAYOUT_PROVIDER: ${requestedProvider}`);
}
const requestedCarrierMinimumFanout = Number(process.env.SIMPLE_CARRIER_MINIMUM_FANOUT);
const simpleLayoutPolicy = process.env.SIMPLE_WHOLE_PROPER_LAYERING === "1"
  ? {
    features: { wholeProperLayering: true },
    ...(Number.isFinite(requestedCarrierMinimumFanout)
      ? { layering: { wholeCarrierMinimumFanout: requestedCarrierMinimumFanout } }
      : {})
  }
  : undefined;
const reports = [];

for (const provider of providers) {
  console.error(`[${provider.id}] layout start`);
  const startedAt = performance.now();
  const graph = await provider.layout(sourceGraph, provider.id === "simple-layered" && simpleLayoutPolicy
    ? { layoutPolicy: simpleLayoutPolicy }
    : {});
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
    missingRouteSummary: summarizeMissingRoutes(graph, missing),
    routingElapsedMs: round(graph.routingMetrics?.elapsedMs || 0),
    layoutMetrics: graph.layoutMetrics || null,
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
    phaseElapsedMs: metrics.phaseElapsedMs || {},
    carrierCandidatePhysicalNetCount: metrics.carrierCandidatePhysicalNetCount || 0,
    carrierPhysicalNetTreeCount: metrics.carrierPhysicalNetTreeCount || 0,
    carrierRoutingSummary: metrics.carrierRoutingSummary || null,
    physicalNetCount: metrics.physicalNetCount || 0,
    unroutablePhysicalNetCount: metrics.unroutablePhysicalNetCount || 0,
    routeKinds: metrics.routeKinds || {},
    physicalNetTrialRejectCounts: metrics.physicalNetTrialRejectCounts || {},
    reservedSegments: metrics.reservedSegments || null,
    capacity: metrics.capacity || null
  };
}

function summarizeMissingRoutes(graph, missing) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const allEdgesByPhysicalNet = new Map();
  for (const edge of graph.edges) {
    const key = getNetGroupKey(edge);
    const edges = allEdgesByPhysicalNet.get(key) || [];
    edges.push(edge);
    allEdgesByPhysicalNet.set(key, edges);
  }
  const missingByPhysicalNet = new Map();
  for (const edge of missing) {
    const key = getNetGroupKey(edge);
    const edges = missingByPhysicalNet.get(key) || [];
    edges.push(edge);
    missingByPhysicalNet.set(key, edges);
  }
  const groups = [...missingByPhysicalNet].map(([physicalNetKey, edges]) => {
    const allEdges = allEdgesByPhysicalNet.get(physicalNetKey) || edges;
    const spans = allEdges.map((edge) => Math.abs(
      Number(nodeById.get(edge.target)?.level || 0) -
      Number(nodeById.get(edge.source)?.level || 0)
    ));
    const assignments = graph.routingCapacity?.allocationByNet?.get(physicalNetKey) || [];
    return {
      physicalNetKey,
      fanout: allEdges.length,
      missing: edges.length,
      maximumSpan: Math.max(0, ...spans),
      overflow: assignments.some((entry) => entry.capacityOverflow === true),
      diagnosticCodes: countCodes(edges.flatMap((edge) => edge.routeDiagnostics || [])),
      diagnosticSamples: edges.flatMap((edge) => edge.routeDiagnostics || []).slice(0, 3)
    };
  }).sort((left, right) =>
    right.missing - left.missing || right.maximumSpan - left.maximumSpan ||
    left.physicalNetKey.localeCompare(right.physicalNetKey));
  return {
    physicalNetCount: groups.length,
    fanoutBuckets: countBuckets(groups, (group) => group.fanout, [1, 3, 7]),
    maximumSpanBuckets: countBuckets(groups, (group) => group.maximumSpan, [1, 2]),
    overflowPhysicalNetCount: groups.filter((group) => group.overflow).length,
    diagnosticCodes: countCodes(missing.flatMap((edge) => edge.routeDiagnostics || [])),
    samples: groups.slice(0, 12)
  };
}

function countBuckets(items, getValue, upperBounds) {
  const counts = {};
  for (const item of items) {
    const value = Number(getValue(item)) || 0;
    const upper = upperBounds.find((bound) => value <= bound);
    const key = upper === undefined ? `>${upperBounds.at(-1)}` : `<=${upper}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function round(value) {
  return Math.round(Number(value) * 1000) / 1000;
}
