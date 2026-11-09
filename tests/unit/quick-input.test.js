import assert from "node:assert/strict";
import test from "node:test";
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

test("submodule navigation resolves only referenced definitions", () => {
  const leaf = { name: "leaf", displayName: "leaf" };
  const design = { modules: [{ name: "top" }, leaf] };

  assert.equal(findReferencedModule(design, { referencedModuleName: "leaf" }), leaf);
  assert.equal(findReferencedModule(design, { referencedModuleName: "missing" }), null);
  assert.equal(findReferencedModule(design, { gateKind: "BUF" }), null);
});
