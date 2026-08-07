import { performance } from "node:perf_hooks";
import { collapseLargeGraph } from "../src/analysis/groupCollapse.js";
import { layoutGraph } from "../src/layout/simpleLayered.js";
import { buildSchematicGraph } from "../src/netlist/graph.js";
import { parseVerilog } from "../src/parser/verilogParser.js";
import {
  createProgressiveSchematicRenderPlan,
  renderSchematicSvg
} from "../src/render/svgRenderer.js";

const sizes = parseSizes(process.env.BENCHMARK_SIZES);
const runs = clampInteger(process.env.BENCHMARK_RUNS, 3, 1, 20);

// Warm up module loading and the main JIT paths before collecting measurements.
runOnce(createBufferChain(32));

const results = [];
for (const cells of sizes) {
  const source = createBufferChain(cells);
  const samples = Array.from({ length: runs }, () => runOnce(source));
  results.push(summarize(cells, source.length, samples));
}

console.log(`Large graph benchmark (${runs} run${runs === 1 ? "" : "s"} per size, median)`);
console.table(results);

function runOnce(source) {
  const parse = measure(() => parseVerilog(source));
  const graph = measure(() => buildSchematicGraph(parse.value.modules[0]));
  const layout = measure(() => layoutGraph(graph.value));
  const svg = measure(() => renderSchematicSvg(layout.value));
  const collapse = measure(() => collapseLargeGraph(graph.value));
  const collapsedLayout = measure(() => layoutGraph(collapse.value));
  const collapsedSvg = measure(() => renderSchematicSvg(collapsedLayout.value));
  const progressivePlan = measure(() => createProgressiveSchematicRenderPlan(layout.value));
  const progressiveFirstBatch = measure(() => renderFirstBatch(progressivePlan.value, 120));
  return {
    parseMs: parse.ms,
    graphMs: graph.ms,
    layoutMs: layout.ms,
    svgMs: svg.ms,
    svgBytes: svg.value.length,
    collapseMs: collapse.ms,
    collapsedNodes: collapse.value.nodes.length,
    collapsedLayoutMs: collapsedLayout.ms,
    collapsedSvgMs: collapsedSvg.ms,
    progressivePlanMs: progressivePlan.ms,
    progressiveFirstBatchMs: progressiveFirstBatch.ms
  };
}

function summarize(cells, sourceBytes, samples) {
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
    collapseMs: round(median(samples.map((sample) => sample.collapseMs))),
    collapsedNodes: Math.round(median(samples.map((sample) => sample.collapsedNodes))),
    collapsedLayoutMs: round(median(samples.map((sample) => sample.collapsedLayoutMs))),
    collapsedSvgMs: round(median(samples.map((sample) => sample.collapsedSvgMs))),
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
