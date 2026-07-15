import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { validateLayoutGraph } from "../../src/layout/layoutValidator.js";
import { layoutGraph } from "../../src/layout/simpleLayered.js";
import { buildSchematicGraph } from "../../src/netlist/graph.js";
import { parseVerilog } from "../../src/parser/verilogParser.js";

const fixtureFiles = [
  new URL("../fixtures/two_equivalent_style_modules.v", import.meta.url),
  ...await Promise.all((await readdir(new URL("../../examples/", import.meta.url)))
    .filter((name) => name.endsWith(".v"))
    .map(async (name) => new URL(`../../examples/${name}`, import.meta.url)))
];
test("all repository netlists satisfy hard routing and net-overlap invariants", async () => {
  const failures = [];
  for (const file of fixtureFiles) {
    const design = parseVerilog(await readFile(file, "utf8"));
    for (const module of design.modules) {
      const graph = buildSchematicGraph(module, { moduleLibrary: design.modules });
      const positioned = layoutGraph(graph);
      const violations = validateLayoutGraph(positioned);
      failures.push(...violations.map((violation) => ({
        file: file.pathname.split("/").at(-1),
        module: module.name,
        edgeId: violation.edgeId,
        code: violation.code
      })));
    }
  }
  assert.deepEqual(failures, []);
});
