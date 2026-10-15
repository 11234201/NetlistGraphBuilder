import { performance } from "node:perf_hooks";
import { getLayoutProvider } from "../src/layout/layoutProvider.js";
import { buildSchematicGraph } from "../src/netlist/graph.js";
import { parseVerilog } from "../src/parser/verilogParser.js";
import {
  createProgressiveSchematicRenderPlan,
  renderSchematicSvg
} from "../src/domains/netlist/netlist_scene.js";

const sizes = parseSizes(process.env.BENCHMARK_SIZES);
const runs = clampInteger(process.env.BENCHMARK_RUNS, 3, 1, 20);
const providerId = process.env.BENCHMARK_PROVIDER || "simple-layered";
const provider = getLayoutProvider(providerId);

// Warm up module loading and the main JIT paths before collecting measurements.
runOnce(createBufferChain(32));

const results = [];
for (const cells of sizes) {
  const source = createBufferChain(cells);
  const samples = Array.from({ length: runs }, () => runOnce(source));
  results.push(summarize(cells, source.length, samples));
}

console.log(`Large graph benchmark (${providerId}; ${runs} run${runs === 1 ? "" : "s"} per size, median)`);
console.table(results);
console.log(JSON.stringify({
  providerId,
  fullNode: true,
  phases: results.map(({ cells, phaseMetrics }) => ({ cells, phaseMetrics }))
}));

function runOnce(source) {
  const parse = measure(() => parseVerilog(source));
  const graph = measure(() => buildSchematicGraph(parse.value.modules[0]));
  const layout = measure(() => provider.layout(graph.value));
  if (layout.value && typeof layout.value.then === "function") {
    throw new Error(`Benchmark provider ${providerId} must be synchronous`);
  }
  const svg = measure(() => renderSchematicSvg(layout.value));
  const progressivePlan = measure(() => createProgressiveSchematicRenderPlan(layout.value));
  const progressiveFirstBatch = measure(() => renderFirstBatch(progressivePlan.value, 120));
  return {
    parseMs: parse.ms,
    graphMs: graph.ms,
    layoutMs: layout.ms,
    svgMs: svg.ms,
    svgBytes: svg.value.length,
    layoutStatus: layout.value.layoutStatus || "unknown",
    violations: layout.value.validationMetrics?.total || 0,
    phaseMetrics: layout.value.layoutMetrics?.phases || null,
    progressivePlanMs: progressivePlan.ms,
    progressiveFirstBatchMs: progressiveFirstBatch.ms
  };
}

function summarize(cells, sourceBytes, samples) {
  const medianSample = [...samples].sort((left, right) => left.layoutMs - right.layoutMs)[Math.floor(samples.length / 2)];
  return {
    cells,
    sourceKiB: round(sourceBytes / 1024),
    parseMs: round(median(samples.map((sample) => sample.parseMs))),
    graphMs: round(median(samples.map((sample) => sample.graphMs))),
    layoutMs: round(median(samples.map((sample) => sample.layoutMs))),
    svgMs: round(median(samples.map((sample) => sample.svgMs))),
    pipelineMs: round(median(samples.map((sample) =>
      sample.parseMs + sample.graphMs + sample.layoutMs + sample.svgMs))),
    svgMiB: round(median(samples.map((sample) => sample.svgBytes)) / 1048576),
    layoutStatus: samples.every((sample) => sample.layoutStatus === "routed") ? "routed" : "unroutable",
    violations: Math.max(...samples.map((sample) => sample.violations)),
    phaseMetrics: medianSample.phaseMetrics,
    progressivePlanMs: round(median(samples.map((sample) => sample.progressivePlanMs))),
    progressiveFirstBatchMs: round(median(samples.map((sample) => sample.progressiveFirstBatchMs)))
  };
}

function renderFirstBatch(plan, batchSize) {
  const edgeEnd = Math.min(plan.edgeCount, batchSize);
  const edges = plan.renderEdges(0, edgeEnd);
  const remaining = batchSize - edgeEnd;
  const nodes = remaining > 0 ? plan.renderNodes(0, remaining) : [];
  return { edges, nodes };
}

function createBufferChain(cellCount) {
  const lines = [
    `module benchmark_chain_${cellCount} (data_in, data_out);`,
    "input data_in;",
    "output data_out;",
    `wire ${Array.from({ length: cellCount - 1 }, (_, index) => `n${index}`).join(", ")};`
  ];
  for (let index = 0; index < cellCount; index += 1) {
    const input = index === 0 ? "data_in" : `n${index - 1}`;
    const output = index === cellCount - 1 ? "data_out" : `n${index}`;
    lines.push(`BUF_X1 u_${index} (.A(${input}), .Z(${output}));`);
  }
  lines.push("endmodule");
  return lines.join("\n");
}

function measure(action) {
  const startedAt = performance.now();
  const value = action();
  return { value, ms: performance.now() - startedAt };
}

function median(values) {
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function parseSizes(value) {
  const parsed = String(value || "1024,4096,8192")
    .split(",")
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((item) => Number.isInteger(item) && item >= 2 && item <= 100000);
  return parsed.length > 0 ? [...new Set(parsed)] : [1024, 4096, 8192];
}

function clampInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function round(value) {
  return Math.round(value * 10) / 10;
}
