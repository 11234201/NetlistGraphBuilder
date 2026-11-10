import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseVerilog } from "../src/parser/verilogParser.js";
import { buildSchematicGraph } from "../src/netlist/graph.js";

// Read-only graph compatibility check against a separately extracted HEAD.
const [baselineRoot, fixturesRoot = "tests/fixtures/mapped"] = process.argv.slice(2);
if (!baselineRoot) throw new Error("Usage: node tools/compare_liberty_baseline.mjs baseline-root [fixtures-root]");
const baseline = await import(pathToFileURL(resolve(baselineRoot, "src/netlist/graph.js")));
const files = [];
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await visit(path);
    else if (entry.name.endsWith("_mapped.v")) files.push(path);
  }
}
await visit(fixturesRoot);
let modules = 0;
for (const path of files.sort()) {
  const design = parseVerilog(await readFile(path, "utf8"));
  for (const module of design.modules) {
    assert.deepEqual(buildSchematicGraph(module, { moduleLibrary: design.modules }),
      baseline.buildSchematicGraph(module, { moduleLibrary: design.modules }), path);
    modules += 1;
  }
}
console.log(JSON.stringify({ files: files.length, modules, fullGraphDifferences: 0 }));
