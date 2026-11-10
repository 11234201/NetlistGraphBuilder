import assert from "node:assert/strict";
import { parseLiberty } from "../src/parser/liberty_parser.js";
import { buildLibertyModel } from "../src/infer/liberty_model.js";
import { LIBERTY_LIMITS } from "../src/contracts/liberty.js";

// Run remotely: node --expose-gc tools/benchmark_liberty.mjs
const prefix = 'library(bench){cell(G){pin(A){direction:input;}pin(Z){direction:output;function:A;}timing(){';
const suffix = '}}}';
const row = 'values("' + '0.123,'.repeat(512) + '");\n';
let previousMs = null, previousModelBytes = null;
for (const mib of [4, 16, 64]) {
  const size = mib * 1024 * 1024;
  const count = Math.floor((size - prefix.length - suffix.length) / row.length);
  const text = prefix + row.repeat(count) + ' '.repeat(size - prefix.length - suffix.length - count * row.length) + suffix;
  globalThis.gc?.();
  const start = performance.now();
  const library = buildLibertyModel(parseLiberty(text));
  const elapsedMs = performance.now() - start;
  const modelBytes = Buffer.byteLength(JSON.stringify(library));
  assert.equal(library.sizeBytes, size);
  assert.equal(library.cells.G.logic.kind, 'buf');
  assert.ok(elapsedMs < 15000, `${mib}MiB exceeded 15s`);
  if (previousMs) assert.ok(elapsedMs < previousMs * 8, 'More than 8x runtime for 4x input');
  if (previousModelBytes) assert.ok(Math.abs(modelBytes - previousModelBytes) < 100, 'Skipped tables grew the retained IR');
  console.log(JSON.stringify({ mib, elapsedMs, modelBytes, peakRssBytes: process.resourceUsage().maxRSS * 1024, maxBytes: LIBERTY_LIMITS.maxBytes }));
  previousMs = elapsedMs; previousModelBytes = modelBytes;
}
