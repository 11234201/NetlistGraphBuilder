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

test("large compare modules stay Search-first until a cone or Whole is requested", () => {
  const cells = Array.from({ length: 520 }, (_, index) => `BUF u${index} (.A(a), .Z(n${index}));`).join(" ");
  const largeSource = `module left (a, y); input a; output y; wire ${Array.from({ length: 520 }, (_, index) => `n${index}`).join(",")}; ${cells} endmodule\n` +
    `module right (a, y); input a; output y; wire ${Array.from({ length: 520 }, (_, index) => `n${index}`).join(",")}; ${cells} endmodule`;
  const [leftModule, rightModule] = parseVerilog(largeSource).modules;
  let layoutCalls = 0;
  const provider = { layout() { layoutCalls += 1; throw new Error("Whole layout should be deferred"); } };
  const deferred = buildCompareWorkspace({ leftModule, rightModule, layoutProvider: provider });

  assert.equal(layoutCalls, 0);
  assert.equal(deferred.graphs.left.view.mode, "search-first");
  assert.equal(deferred.graphs.right.nodes.length, 0);
  assert.equal(deferred.analysis.left.cells, 520);

  const whole = buildCompareWorkspace({ leftModule, rightModule, layoutProvider: getLayoutProvider(), forceWhole: true });
  assert.ok(whole.graphs.left.nodes.length > 0);
});

test("compare workspace reports side lifecycle and cancels stale async layouts", async () => {
  const [leftModule, rightModule] = parseVerilog(source).modules;
  const pending = [];
  const statuses = [];
  const controller = new AbortController();
  const provider = {
    layout(graph) {
      return new Promise((resolve) => pending.push(() => resolve(getLayoutProvider().layout(graph))));
    }
  };
  const workspacePromise = buildCompareWorkspace({
    leftModule,
    rightModule,
    layoutProvider: provider,
    signal: controller.signal,
    onSideStatus: (side, status) => statuses.push(`${side}:${status}`)
  });
  assert.deepEqual(statuses, ["left:loading", "right:loading"]);
  controller.abort();
  pending.splice(0).forEach((resolve) => resolve());
  await assert.rejects(workspacePromise, (error) => error.name === "AbortError");
  assert.ok(statuses.includes("left:cancelled"));
  assert.ok(statuses.includes("right:cancelled"));
});
