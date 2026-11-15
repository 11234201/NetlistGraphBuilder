import { performance } from "node:perf_hooks";
import { importAigSource } from "../src/domains/aig/aig_import.js";
import { analyzeAig } from "../src/domains/aig/aig_analysis.js";
import { AIG_IMPORT_LIMITS } from "../src/domains/aig/aig_diagnostics.js";
import { projectAigDot, AIG_GRAPHVIZ_POLICY } from "../src/domains/aig/aig_projection.js";
import { createAigScene } from "../src/domains/aig/aig_scene.js";
import { graphvizJsonToGeometry } from "../src/layout/graphviz_geometry.js";
import { instance } from "../src/platform/graphviz_vendor.js";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import assert from "node:assert/strict";

// Deliberately bounded synthetic cases. This measures the production embedded
// WASM and Scene pipeline, without external executables or package installation.
const requestedSize = Number(process.env.AIG_BENCHMARK_SIZE || 80);
if (!Number.isInteger(requestedSize) || requestedSize < 20 || requestedSize > 250) throw new Error("AIG_BENCHMARK_SIZE must be an integer from 20 to 250");
const caseTimeoutMs = 20000;
const policies = {
  default: "",
  simplex2: "nslimit=2,nslimit1=2",
  simplex2_mincross025: "nslimit=2,nslimit1=2,mclimit=0.25",
  simplex025_mincross025: "nslimit=0.25,nslimit1=0.25,mclimit=0.25",
  simplex0_mincross025: "nslimit=0,nslimit1=0,mclimit=0.25"
};
const policy = process.env.AIG_BENCHMARK_POLICY || "default";
if (!(policy in policies)) throw new Error(`Unknown AIG_BENCHMARK_POLICY '${policy}'`);
const kinds = ["wide", "chain", "reconvergent", "high-fanout"];
const selectedKind = process.env.AIG_BENCHMARK_CASE;
if (selectedKind && !kinds.includes(selectedKind)) throw new Error(`Unknown AIG_BENCHMARK_CASE '${selectedKind}'`);
if (isMainThread) {
  const cases = [];
  for (const kind of selectedKind ? [selectedKind] : kinds) cases.push(await runWorkerCase(kind));
  console.log(JSON.stringify({ provider: "graphviz", nodeVersion: process.version, size: requestedSize,
    policy, productionPolicy: AIG_GRAPHVIZ_POLICY, graphAttributes: policies[policy], caseTimeoutMs, importLimits: AIG_IMPORT_LIMITS, cases }, null, 2));
  if (cases.some((result) => result.error)) process.exitCode = 1;
} else parentPort.postMessage(await benchmarkCase(workerData.kind, workerData.size));

function runWorkerCase(kind) {
  return new Promise((resolve) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { kind, size: requestedSize } });
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ kind, error: `Benchmark exceeded ${caseTimeoutMs} ms; worker terminated` }), caseTimeoutMs);
    worker.on("message", finish);
    worker.on("error", (error) => finish({ kind, error: error.message }));
    worker.on("exit", (code) => { if (!settled) finish({ kind, error: `Worker exited before reporting (${code})` }); });
  });
}

async function benchmarkCase(kind, size) {
  const wasmStart = performance.now();
  const viz = await instance();
  const coldInitializationMs = performance.now() - wasmStart;
  const text = buildCase(kind, size);
  const heapBefore = process.memoryUsage().heapUsed;
  const importStart = performance.now();
  const data = importAigSource(text, { format: "blif", name: `${kind}.blif` });
  const importMs = performance.now() - importStart;
  const analysisStart = performance.now();
  analyzeAig(data.model);
  const analysisMs = performance.now() - analysisStart;
  const dotStart = performance.now();
  const productionDot = projectAigDot(data.model);
  const dot = policies[policy] ? productionDot.replace(/, nslimit=[^,\]]+, nslimit1=[^\]]+/, `, ${policies[policy]}`) : productionDot;
  const projectionMs = performance.now() - dotStart;
  const layoutStart = performance.now();
  const geometry = graphvizJsonToGeometry(viz.renderJSON(dot));
  const layoutMs = performance.now() - layoutStart;
  verifyGeometry(data.model, geometry);
  const repeatStart = performance.now();
  const repeat = graphvizJsonToGeometry(viz.renderJSON(dot));
  const repeatLayoutMs = performance.now() - repeatStart;
  assert.deepEqual(repeat, geometry, "Graphviz geometry must repeat exactly");
  const sceneStart = performance.now();
  const scene = createAigScene(data.model, data.analysis, geometry);
  // Consume bounded batches to measure the actual lazy primitive producers.
  let primitiveGroups = 0;
  for (let start = 0; start < scene.nodeCount; start += 100) primitiveGroups += scene.readNodes(start, Math.min(start + 100, scene.nodeCount)).length;
  for (let start = 0; start < scene.edgeCount; start += 100) primitiveGroups += scene.readEdges(start, Math.min(start + 100, scene.edgeCount)).length;
  const sceneMs = performance.now() - sceneStart;
  return { kind, graphvizVersion: viz.graphvizVersion, coldInitializationMs, nodes: data.model.nodes.length, edges: data.model.edges.length, depth: data.analysis.depth,
    importMs, analysisMs, projectionMs, layoutMs, repeatLayoutMs, geometryStable: true, sceneMs, primitiveGroups,
    heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore, rssBytes: process.memoryUsage().rss };
}

function verifyGeometry(model, geometry) {
  assert.deepEqual(new Set(geometry.nodes.map((node) => node.id)), new Set(model.nodes.map((node) => node.id)));
  assert.deepEqual(new Set(geometry.edges.map((edge) => edge.id)), new Set(model.edges.map((edge) => edge.id)));
  const nodes = new Map(geometry.nodes.map((node) => [node.id, node]));
  const ranks = new Map();
  for (const node of model.nodes) {
    const rank = node.kind === "po" ? "output" : node.level;
    const y = nodes.get(node.id).center.y;
    if (ranks.has(rank)) assert.equal(y, ranks.get(rank), `Inconsistent rank ${rank}`);
    else ranks.set(rank, y);
  }
  for (const edge of model.edges) assert.ok(nodes.get(edge.source).center.y > nodes.get(edge.target).center.y, "Signal flow must remain bottom to top");
  for (const edge of geometry.edges) assert.ok(edge.paths.length && edge.arrows.length, "Every logical edge needs curve and arrow geometry");
}

function buildCase(kind, size) {
  const inputs = ["a", "b", ...Array.from({ length: size }, (_, index) => `p${index}`)];
  const declarations = [];
  const outputs = [];
  for (let index = 0; index < size; index++) {
    const previous = index ? `g${index - 1}` : "a";
    if (kind === "wide") declarations.push(`.names p${index} b g${index}\n11 1`);
    else if (kind === "chain") declarations.push(`.names ${previous} b g${index}\n11 1`);
    else if (kind === "high-fanout") declarations.push(`.names a p${index} g${index}\n${index % 2 ? "01" : "11"} 1`);
    else {
      declarations.push(`.names ${previous} p${index} left${index}\n11 1`);
      declarations.push(`.names ${previous} b right${index}\n01 1`);
      declarations.push(`.names left${index} right${index} g${index}\n11 1`);
    }
    if (kind === "wide" || kind === "high-fanout" || index === size - 1) outputs.push(`g${index}`);
  }
  return `.model ${kind}\n.inputs ${inputs.join(" ")}\n.outputs ${outputs.join(" ")}\n${declarations.join("\n")}\n.end\n`;
}
