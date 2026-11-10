import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { parseLiberty } from "../src/parser/liberty_parser.js";
import { buildLibertyModel } from "../src/infer/liberty_model.js";

const [inputPath, oraclePath] = process.argv.slice(2);
if (!inputPath || !oraclePath) throw new Error("Usage: node tools/test_liberty_cases.mjs input.lib oracle.json");
const text = readFileSync(inputPath, "utf8");
const started = performance.now();
const library = buildLibertyModel(parseLiberty(text, { name: inputPath }));
const elapsedMs = performance.now() - started;
const oracle = JSON.parse(readFileSync(oraclePath, "utf8"));
const cells = Object.fromEntries(Object.values(library.cells).map((cell) => [cell.name,
  Object.fromEntries(Object.values(cell.pins).map((pin) => [pin.name, { direction: pin.direction, function: pin.function }]))]));
const differences = [];
for (const name of new Set([...Object.keys(cells), ...Object.keys(oracle.cells)])) {
  if (!cells[name] || !oracle.cells[name]) { differences.push(`${name}: missing cell`); continue; }
  for (const pin of new Set([...Object.keys(cells[name]), ...Object.keys(oracle.cells[name])])) {
    try { assert.deepEqual(cells[name][pin], oracle.cells[name][pin]); }
    catch { differences.push(`${name}.${pin}: actual=${JSON.stringify(cells[name][pin])} oracle=${JSON.stringify(oracle.cells[name][pin])}`); }
  }
}
assert.equal(differences.length, 0, differences.slice(0, 20).join("\n"));
console.log(JSON.stringify({ inputPath, sha256: createHash("sha256").update(text).digest("hex"),
  cells: library.cellCount, pins: Object.values(cells).reduce((sum, pins) => sum + Object.keys(pins).length, 0),
  diagnostics: library.diagnostics.length, elapsedMs, rssBytes: process.memoryUsage().rss,
  modelBytes: Buffer.byteLength(JSON.stringify(library)), oracle: oracle.oracle, oracleVersion: oracle.version,
  interfaceDifferences: 0 }));
