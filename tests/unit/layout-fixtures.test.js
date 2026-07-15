import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { normalizeGraphAliases } from "../../src/analysis/aliasNormalizer.js";
import { analyzeLayoutQuality } from "../../src/layout/layoutQuality.js";
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
  for (const fixture of await loadFixtureLayouts()) {
    const violations = validateLayoutGraph(fixture.graph);
    failures.push(...violations.map((violation) => ({
      file: fixture.file,
      module: fixture.module,
      edgeId: violation.edgeId,
      code: violation.code
    })));
  }
  assert.deepEqual(failures, []);
});

test("repository netlists retain broad schematic readability budgets", async () => {
  const failures = [];
  for (const fixture of await loadFixtureLayouts()) {
    const quality = analyzeLayoutQuality(fixture.graph);
    if (quality.edgeCount > 0 && quality.directRouteRatio < 0.65) {
      failures.push({ ...fixtureKey(fixture), metric: "directRouteRatio", value: quality.directRouteRatio });
    }
    if (quality.maxBends > 4) {
      failures.push({ ...fixtureKey(fixture), metric: "maxBends", value: quality.maxBends });
    }
    const crossingBudget = Math.max(4, Math.ceil(quality.edgeCount * 0.25));
    if (quality.crossingCount > crossingBudget) {
      failures.push({ ...fixtureKey(fixture), metric: "crossingCount", value: quality.crossingCount });
    }
    const outerRouteBudget = Math.max(1, Math.ceil(quality.edgeCount * 0.05));
    if (quality.outerRouteCount > outerRouteBudget) {
      failures.push({ ...fixtureKey(fixture), metric: "outerRouteCount", value: quality.outerRouteCount });
    }
  }
  assert.deepEqual(failures, []);
});

let fixtureLayoutsPromise;

function loadFixtureLayouts() {
  fixtureLayoutsPromise ||= Promise.all(fixtureFiles.map(async (file) => {
    const design = parseVerilog(await readFile(file, "utf8"));
    return design.modules.map((module) => {
      const graph = normalizeGraphAliases(
        buildSchematicGraph(module, { moduleLibrary: design.modules }),
        { showAliases: false }
      );
      return {
        file: file.pathname.split("/").at(-1),
        module: module.name,
        graph: layoutGraph(graph)
      };
    });
  })).then((groups) => groups.flat());
  return fixtureLayoutsPromise;
}

function fixtureKey(fixture) {
  return { file: fixture.file, module: fixture.module };
}
