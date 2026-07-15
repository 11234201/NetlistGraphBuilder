import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildCompareWorkspace } from "../../src/app/compareWorkspace.js";
import { getLayoutProvider } from "../../src/layout/layoutProvider.js";
import { parseVerilog } from "../../src/parser/verilogParser.js";
import { parseTimingLog } from "../../src/timing/timingParser.js";

const source = `module \\root (\\u/in , \\u/out ); input \\u/in ; output \\u/out ; BUF u0 (.A(\\u/in ),.Z(\\u/out )); endmodule
module \\root_Flex (\\u/in , \\u/out ); input \\u/in ; output \\u/out ; INV u1 (.I(\\u/in ),.ZN(\\u/out )); endmodule`;

test("compare workspace composes escaped output cones through provider boundary", () => {
  const [leftModule, rightModule] = parseVerilog(source).modules;
  const workspace = buildCompareWorkspace({
    leftModule,
    rightModule,
    layoutProvider: getLayoutProvider(),
    outputName: "u/out",
    coneDepth: 3
  });

  assert.ok(workspace.graphs.left.nodes.length > 0);
  assert.ok(workspace.graphs.right.nodes.length > 0);
  assert.ok(workspace.graphs.left.nodes.some((node) => node.kind === "output"));
  assert.equal(workspace.analysis.left.cells, 1);
  assert.equal(workspace.analysis.right.cells, 1);
});

test("compare workspace annotates timing on both modules", async () => {
  const netlistUrl = new URL("../../examples/hierarchical_escaped_compare.v", import.meta.url);
  const timingUrl = new URL("../../examples/hierarchical_escaped_timing.txt", import.meta.url);
  const design = parseVerilog(await readFile(netlistUrl, "utf8"));
  const timing = parseTimingLog(await readFile(timingUrl, "utf8"));
  const pair = design.modules.filter((module) =>
    module.name.includes("GNUWA_DYNAMIC_ADDER_gen_1134_0_13_78272_7")
  );
  const workspace = buildCompareWorkspace({
    leftModule: pair.find((module) => !module.name.endsWith("_Flex")),
    rightModule: pair.find((module) => module.name.endsWith("_Flex")),
    layoutProvider: getLayoutProvider(),
    timing
  });

  const leftTimed = workspace.graphs.left.nodes.filter((node) => node.timing);
  const rightTimed = workspace.graphs.right.nodes.filter((node) => node.timing);
  assert.ok(leftTimed.length > 0);
  assert.ok(rightTimed.length > 0);
  assert.ok(leftTimed.some((node) => node.timing.badges.length > 0));
  assert.ok(rightTimed.some((node) => node.timing.badges.length > 0));
});

test("compare workspace applies layout and graph overrides independently per side", () => {
  const [leftModule, rightModule] = parseVerilog(source).modules;
  const workspace = buildCompareWorkspace({
    leftModule,
    rightModule,
    layoutProvider: getLayoutProvider(),
    nodeSizes: {
      left: new Map([["cell:u0", { width: 210, height: 90 }]]),
      right: new Map([["cell:u1", { width: 170, height: 80 }]])
    },
    graphOverrides: {
      left: { nodeProperties: { "cell:u0": { label: "left-adjusted" } }, cellPinDirections: {} },
      right: { nodeProperties: {}, cellPinDirections: {} }
    }
  });

  const leftCell = workspace.graphs.left.nodes.find((node) => node.id === "cell:u0");
  const rightCell = workspace.graphs.right.nodes.find((node) => node.id === "cell:u1");
  const autoLeftCell = workspace.autoGraphs.left.nodes.find((node) => node.id === "cell:u0");
  assert.equal(leftCell.label, "left-adjusted");
  assert.equal(leftCell.width, 210);
  assert.equal(rightCell.width, 170);
  assert.notEqual(autoLeftCell.width, 210);
  assert.notEqual(rightCell.label, "left-adjusted");
});
