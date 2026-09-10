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
  assert.equal(workspace.scenes.left.nodeCount, workspace.graphs.left.nodes.length);
  assert.equal(workspace.scenes.right.nodeCount, workspace.graphs.right.nodes.length);
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

test("compare workspace preserves independent multi-cell focused roots per side", () => {
  const leftSource = `module left (a, y1, y2); input a; output y1; output y2; BUF u0 (.A(a), .Z(y1)); INV u1 (.I(a), .ZN(y2)); endmodule`;
  const rightSource = `module right (a, y1, y2); input a; output y1; output y2; INV u0 (.I(a), .ZN(y1)); BUF u1 (.A(a), .Z(y2)); endmodule`;
  const [leftModule] = parseVerilog(leftSource).modules;
  const [rightModule] = parseVerilog(rightSource).modules;
  const workspace = buildCompareWorkspace({
    leftModule,
    rightModule,
    layoutProvider: getLayoutProvider(),
    focusedRootNodeIds: {
      left: ["cell:u1", "cell:u0"],
      right: ["cell:u1"]
    },
    activeFocusedRootNodeId: { left: "cell:u1", right: "cell:u1" },
    faninDepth: 2,
    fanoutDepth: 2
  });

  assert.deepEqual(workspace.graphs.left.view.rootNodeIds, ["cell:u0", "cell:u1"]);
  assert.equal(workspace.graphs.right.view.rootNodeId, "cell:u1");
  assert.ok(workspace.graphs.left.nodes.some((node) => node.id === "cell:u0" && node.isFocusedRoot));
  assert.ok(workspace.graphs.left.nodes.some((node) => node.id === "cell:u1" && node.isActiveFocusedRoot));
  assert.ok(workspace.graphs.left.nodes.some((node) => node.kind === "output"));
});
