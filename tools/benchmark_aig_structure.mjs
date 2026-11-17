import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { analyzeAigStructure } from "../src/domains/aig/structure_analysis.js";
import { normalizeStructurePolicy } from "../src/domains/aig/structure_policy.js";

const policy = normalizeStructurePolicy(), sizes = [1000, 4000, 10000, 99000];
if (isMainThread) {
  const cases = [];
  for (const size of sizes) for (const kind of ["chain", "fanout", "reconvergence", "parity", "mux"]) {
    const result = await new Promise((resolve) => {
      const worker = new Worker(new URL(import.meta.url), { workerData: { size, kind } });
      let settled = false;
      const finish = (result) => { if (settled) return; settled = true; clearTimeout(timer); void worker.terminate(); resolve(result); };
      const timer = setTimeout(() => finish({ size, kind, error: "15 second budget exceeded" }), policy.workerTimeoutMs);
      worker.on("message", finish); worker.on("error", (error) => finish({ size, kind, error: error.message }));
    });
    cases.push(result); console.log(JSON.stringify(result));
  }
  console.log(JSON.stringify({ nodeVersion: process.version, policy, cases }));
  if (cases.some((result) => result.error)) process.exitCode = 1;
} else {
  const { size, kind } = workerData, graph = build(size, kind), before = process.memoryUsage().heapUsed, start = performance.now();
  const result = analyzeAigStructure(graph), elapsedMs = performance.now() - start;
  assert.ok(result.blocks.work <= policy.blockWork); assert.ok(result.reconvergence.work <= policy.reconvergenceWork);
  assert.ok(result.blocks.results.length <= policy.results); assert.ok(result.reconvergence.results.length <= policy.results);
  parentPort.postMessage({ size, kind, nodes: graph.nodes.length, edges: graph.edges.length,
    elapsedMs: Math.round(elapsedMs), heapDeltaMiB: Math.round((process.memoryUsage().heapUsed - before) / 1048576),
    blocks: result.blocks.results.length, pairs: result.reconvergence.results.length, status: result.status,
    reasons: [...new Set([...result.blocks.reasons, ...result.reconvergence.reasons])] });
}

function build(size, kind) {
  const nodes = [], edges = [], levels = new Map();
  const pi = (id) => { nodes.push({ id, label: id, kind: "pi", level: 0 }); levels.set(id, 0); return id; };
  const and = (first, second, negFirst = false, negSecond = false) => {
    const id = `n${nodes.length}`, level = 1 + Math.max(levels.get(first), levels.get(second));
    levels.set(id, level); nodes.push({ id, label: id, kind: "and", level });
    [first, second].forEach((source, slot) => edges.push({ id: `${id}:${slot}`, source, target: id, slot, inverted: slot ? negSecond : negFirst }));
    return id;
  };
  const a = pi("a"), b = pi("b"), c = pi("c"); let previous = a;
  while (nodes.length + 3 <= size) {
    if (kind === "chain") previous = and(previous, b);
    else if (kind === "fanout") and(a, pi(`p${nodes.length}`));
    else if (kind === "parity") previous = and(and(previous, b), and(previous, b, true, true), true, true);
    else if (kind === "mux") previous = and(and(c, previous), and(c, b, true), true, true);
    else previous = and(and(previous, b), and(previous, c));
  }
  return { nodes, edges };
}
