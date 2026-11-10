import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { parseLiberty } from "../src/parser/liberty_parser.js";
import { buildLibertyModel } from "../src/infer/liberty_model.js";

const [manifestPath, oraclePath, reportPath] = process.argv.slice(2);
if (!reportPath) throw new Error("Usage: node tools/test_liberty_truth.mjs manifest.json oracle.json report.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const oracle = JSON.parse(await readFile(oraclePath, "utf8"));
const results = [];
for (const entry of manifest.libraries) {
  const library = buildLibertyModel(parseLiberty(await readFile(entry.path, "utf8")));
  for (const [name, expected] of Object.entries(oracle.libraries[entry.name].cells)) {
    const cell = library.cells[name];
    const result = { library: entry.name, cell: name, status: "failed", truthRows: 0 };
    try {
      assert.ok(cell, `Missing ${name}`);
      assert.deepEqual(Object.keys(cell.pins).sort(), Object.keys(expected.pins).sort());
      for (const [pin, value] of Object.entries(expected.pins)) {
        assert.deepEqual({ direction: cell.pins[pin].direction, function: cell.pins[pin].function, threeState: cell.pins[pin].threeState }, value);
      }
      const threeState = Object.values(expected.pins).some((pin) => pin.threeState !== null || pin.direction === "inout");
      if (threeState) assert.equal(cell.logic.kind, "blackbox");
      else if (expected.sequential.length) {
        assert.equal(cell.logic.status, "sequential");
        assert.ok(["dff", "blackbox"].includes(cell.logic.kind));
      } else if (cell.logic.status === "recognized") {
        const tables = Object.values(expected.functions);
        assert.equal(tables.length, 1, "Recognized gate must have exactly one independently evaluated output");
        const { variables, truth } = tables[0];
        assert.ok(truth, "Recognized gate has no independent truth table");
        const kind = cell.logic.kind;
        assert.ok(["buf", "inv", "and", "nand", "or", "nor", "xor", "xnor", "mux"].includes(kind), `Unexpected recognized kind ${kind}`);
        const evaluate = (mask, reverseMux = false) => {
          const values = variables.map((_, index) => Boolean(mask & (1 << index)));
          if (kind === "mux") {
            const select = variables.indexOf(cell.logic.selectPin);
            assert.ok(select >= 0, "Mux select must be an input");
            const data = values.filter((_, index) => index !== select);
            if (reverseMux) data.reverse();
            return data[values[select] ? 1 : 0];
          }
          const value = ["buf", "inv"].includes(kind) ? values[0] : ["and", "nand"].includes(kind) ? values.every(Boolean)
            : ["or", "nor"].includes(kind) ? values.some(Boolean) : values.filter(Boolean).length % 2 === 1;
          return ["inv", "nand", "nor", "xnor"].includes(kind) ? !value : value;
        };
        assert.ok(truth.every((value, mask) => value === evaluate(mask)) ||
          (kind === "mux" && truth.every((value, mask) => value === evaluate(mask, true))), `Incorrect ${kind} classification`);
        result.truthRows = truth.length;
      } else assert.equal(cell.logic.kind, "blackbox");
      Object.assign(result, { status: "passed", gateKind: cell.logic.kind, logicStatus: cell.logic.status });
    } catch (error) { result.error = error.message; }
    results.push(result);
  }
}
const summary = { types: results.length, failed: results.filter((item) => item.status !== "passed").length,
  recognized: results.filter((item) => item.logicStatus === "recognized").length,
  sequential: results.filter((item) => item.logicStatus === "sequential").length,
  truthRows: results.reduce((sum, item) => sum + item.truthRows, 0), results };
await writeFile(reportPath, JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify({ ...summary, results: summary.results.filter((item) => item.status !== "passed") }));
if (summary.failed) process.exitCode = 1;
