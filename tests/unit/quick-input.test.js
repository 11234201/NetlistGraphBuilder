import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { findReferencedModule } from "../../src/app/moduleNavigation.js";
import {
  detectQuickInputKind,
  getQuickInputPriority
} from "../../src/app/quickInput.js";

test("quick input recognizes files and pasted content", () => {
  const netlist = "module top(input a, output y); assign y = a; endmodule";
  const golden = JSON.stringify({ kind: "netlist-layout-golden" });
  const timing = "@module top\npoint at rt slack\nu0/A 1.0 0.1 -0.2";
  const timingJson = JSON.stringify({
    version: "1.0",
    stage: "post_map",
    points: { "u0/A": [1.0, 0.1, -0.2] }
  });

  assert.equal(detectQuickInputKind("ignored", { name: "design.v" }), "netlist");
  assert.equal(detectQuickInputKind("ignored", { name: "layout.json" }), "golden");
  assert.equal(detectQuickInputKind("ignored", { name: "timing.log" }), "timing");
  assert.equal(detectQuickInputKind("ignored", { name: "timing.csv" }), "timing");
  assert.equal(detectQuickInputKind(netlist), "netlist");
  assert.equal(detectQuickInputKind(golden), "golden");
  assert.equal(detectQuickInputKind(timing), "timing");
  assert.equal(detectQuickInputKind("u0/A 0.45 0.10 -0.35"), "timing");
  assert.equal(detectQuickInputKind(timingJson), "timing");
  assert.equal(detectQuickInputKind(timingJson, { name: "report.json" }), "timing");
  assert.equal(detectQuickInputKind(timing, { preferredKind: "netlist" }), "netlist");
  assert.throws(() => detectQuickInputKind("plain notes"), /not recognized/);
});

test("multi-file quick input orders netlist before timing and Golden", () => {
  assert.ok(getQuickInputPriority("netlist") < getQuickInputPriority("timing"));
  assert.ok(getQuickInputPriority("timing") < getQuickInputPriority("golden"));
});

test("content classification handles long comment headers without backtracking", () => {
  // Isolate the synchronous classifier so a regression cannot hang the test runner.
  const moduleUrl = new URL("../../src/app/quickInput.js", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { detectQuickInputKind } from ${JSON.stringify(moduleUrl)};
    const header = '/* comment */'.repeat(10000) + '\\n';
    process.stdout.write(detectQuickInputKind(header + 'module top; endmodule'));
  `], { encoding: "utf8", timeout: 5000 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "netlist");
});

test("Liberty classification skips comment trivia without consuming identifiers", () => {
  for (const source of [
    "/* first */ // second\r\nlibrary(x){}",
    "library /* name follows */ (x){}",
    "library// name follows\n(x){}"
  ]) assert.equal(detectQuickInputKind(source), "liberty");
  for (const source of ["librarySuffix(x){}", "/* unterminated library(x){}", "library /* unterminated"])
    assert.throws(() => detectQuickInputKind(source), /not recognized/);
});

test("submodule navigation resolves only referenced definitions", () => {
  const leaf = { name: "leaf", displayName: "leaf" };
  const design = { modules: [{ name: "top" }, leaf] };

  assert.equal(findReferencedModule(design, { referencedModuleName: "leaf" }), leaf);
  assert.equal(findReferencedModule(design, { referencedModuleName: "missing" }), null);
  assert.equal(findReferencedModule(design, { gateKind: "BUF" }), null);
});
