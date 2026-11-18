import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { importAigSource } from "../src/domains/aig/aig_import.js";
import { buildAigSearchIndex, searchAigIndex } from "../src/domains/aig/aig_query.js";
import { createFocusedNeighborhoodGraph } from "../src/analysis/graphCone.js";
import { DEFAULT_FOCUSED_VIEW_POLICY } from "../src/foundation/view_policy.js";
import { buildSchematicGraph } from "../src/netlist/graph.js";
import { parseVerilog } from "../src/parser/verilogParser.js";

// Run each case as a separate Node process for an independent RSS high-water
// mark. blif-import also runs on the pre-feature revision for a timing baseline.
const mode = process.argv[2] || "blif-focused";
const samples = [];
const size = 4096;
function measure(sample, key, action) {
  const start = performance.now();
  const value = action();
  sample[key] = performance.now() - start;
  return value;
}

function mappedBlif() {
  const inputs = ["n0"], outputs = [], tables = [], mappings = ["# n0 top/primary/clock_enable"];
  for (let i = 1; i <= size; i++) {
    const input = `n${i}`, output = `n${size + i}`;
    inputs.push(input); outputs.push(output);
    mappings.push(`# ${input} top/datapath/in[${i}]`, `# ${output} top/datapath/out[${i}]`);
    tables.push(`.names n0 ${input} ${output}\n${i % 2 ? "1- 1\n-1 1" : "11 1"}`);
  }
  return mappings.concat([".model mapped", ".inputs " + inputs.join(" "), ".outputs " + outputs.join(" "), ...tables, ".end"]).join("\n");
}

async function blif() {
  const text = mappedBlif();
  const queryAig = mode === "blif-focused" ? (await import("../src/domains/aig/aig_view_query.js")).queryAigView : null;
  let stats;
  for (let iteration = 0; iteration < 6; iteration++) {
    globalThis.gc?.();
    const sample = {};
    const data = measure(sample, "importMs", () => importAigSource(text, { name: "many_names.blif" }));
    const index = measure(sample, "indexMs", () => buildAigSearchIndex(data.model));
    stats = { sourceBytes: Buffer.byteLength(text), sourceMappings: 1 + 2 * size,
      boundRows: data.model.nameMappings?.length || 0, nodes: data.model.nodes.length, edges: data.model.edges.length };
    if (queryAig) {
      const hits = measure(sample, "lookupMs", () => searchAigIndex(index, "datapath/out[4096]", 100));
      assert.equal(hits.length, 2, "the port and the driver have distinct identities");
      const root = searchAigIndex(index, "clock_enable", 1)[0].id;
      const view = measure(sample, "queryMs", () => queryAig({ model: data }, { viewMode: "focused", rootNodeIds: [root], faninDepth: 0, fanoutDepth: 1 }));
      assert.equal(view.visibleNodeIds.size, DEFAULT_FOCUSED_VIEW_POLICY.maximumVisibleNodes);
      assert.ok(view.truncated && view.hiddenEndpointCount > 0);
      stats.visibleNodes = view.visibleNodeIds.size;
      stats.visibleEdges = view.visibleEdgeIds.size;
      stats.cutNodes = view.model.nodes.length - stats.visibleNodes;
      stats.hiddenEndpoints = view.hiddenEndpointCount;
    }
    if (iteration) samples.push(sample);
  }
  return stats;
}

function netlistSource(chain) {
  const lines = ["module bench(input a, input b, output y);"];
  // Each diamond uses two distinct cells for the branches and a third cell
  // for the merge. Fanout shares one PI, while the chain cascades diamonds.
  for (let i = 0; i < size; i++) {
    const start = chain && i ? `m${i - 1}` : "a";
    lines.push(`wire l${i}, r${i}, m${i};`,
      `BUF_X1 lo_${i} (.A(${start}), .Z(l${i}));`,
      `NAND2_X1 hi_${i} (.A(${start}), .B(b), .ZN(r${i}));`,
      `NAND2_X1 join_${i} (.A(l${i}), .B(r${i}), .ZN(m${i}));`);
  }
  return lines.concat([`assign y = m${size - 1};`, "endmodule"]).join("\n");
}

async function netlist() {
  const { createNetlistReconvergenceScope } = await import("../src/domains/netlist/reconvergence_scope.js");
  const { createNetlistStructureIndex, analyzeNetlistReconvergence } = await import("../src/domains/netlist/reconvergence_analysis.js");
  const chain = mode === "netlist-chain", text = netlistSource(chain);
  const source = buildSchematicGraph(parseVerilog(text).modules[0]);
  const root = source.nodes.find((node) => node.label === (chain ? "join_2047" : "a")).id;
  let stats;
  for (let iteration = 0; iteration < 6; iteration++) {
    globalThis.gc?.();
    const sample = {};
    const focused = measure(sample, "queryMs", () => createFocusedNeighborhoodGraph(source, root, {
      ...DEFAULT_FOCUSED_VIEW_POLICY, rootNodeIds: [root], faninDepth: chain ? 32 : 0, fanoutDepth: chain ? 32 : 2 }));
    const scope = measure(sample, "scopeMs", () => createNetlistReconvergenceScope(source, focused));
    const result = measure(sample, "analysisMs", () => analyzeNetlistReconvergence(createNetlistStructureIndex(scope.model)));
    assert.ok(scope.visibleCount <= DEFAULT_FOCUSED_VIEW_POLICY.maximumVisibleNodes);
    assert.ok(chain ? result.reconvergence.results.length > 0 : focused.view.truncated);
    stats = { sourceBytes: Buffer.byteLength(text), nodes: source.nodes.length, edges: source.edges.length,
      visibleNodes: scope.visibleCount, visibleEdges: focused.edges.length,
      hiddenEndpoints: focused.view.hiddenEndpointCount || 0, pairs: result.reconvergence.results.length,
      status: result.status, reasons: result.reconvergence.reasons, work: result.reconvergence.work };
    if (iteration) samples.push(sample);
  }
  return stats;
}

assert.ok(["blif-import", "blif-focused", "netlist-chain", "netlist-fanout"].includes(mode));
const stats = mode.startsWith("blif-") ? await blif() : await netlist();
const milliseconds = Object.fromEntries(Object.keys(samples[0]).map((key) => {
  const sorted = samples.map((sample) => sample[key]).sort((a, b) => a - b);
  return [key, { median: sorted[2], p95: sorted[4] }];
}));
console.log(JSON.stringify({ mode, node: process.version, runs: samples.length, warmups: 1, stats, milliseconds,
  maxRssKiB: process.resourceUsage().maxRSS, budget: DEFAULT_FOCUSED_VIEW_POLICY, samples }));
