import assert from "node:assert/strict";
import test from "node:test";
import {
  alignModulePorts,
  analyzeGraphStats,
  compareModules,
  recommendModulePair
} from "../../src/analysis/moduleCompare.js";
import { buildSchematicGraph } from "../../src/netlist/graph.js";
import { createConeGraph } from "../../src/analysis/graphCone.js";
import { parseVerilog } from "../../src/parser/verilogParser.js";

const source = `module root(a,b,y); input a; input b; output y; wire n;
AND2 u0 (.A1(a),.A2(b),.Z(n)); BUF u1 (.A(n),.Z(y)); endmodule
module root_Flex(b,a,y,extra); input b; input a; output y; output extra;
NAND2 u2 (.A1(a),.A2(b),.ZN(y)); BUF u3 (.A(a),.Z(extra)); endmodule`;

test("module pairing recognizes compare suffixes", () => {
  const modules = parseVerilog(source).modules;
  assert.equal(recommendModulePair(modules, "root").name, "root_Flex");
  assert.equal(recommendModulePair(modules, "root_Flex").name, "root");
});

test("port alignment gives common ports stable order and marks unmatched ports", () => {
  const [left, right] = parseVerilog(source).modules;
  const ports = alignModulePorts(left, right);
  assert.deepEqual(ports.map((port) => port.name), ["a", "b", "extra", "y"]);
  assert.equal(ports.find((port) => port.name === "y").matched, true);
  assert.equal(ports.find((port) => port.name === "extra").matched, false);
});

test("compare analysis reports gate counts, depth, fanout and unmatched objects", () => {
  const [left, right] = parseVerilog(source).modules;
  const leftGraph = buildSchematicGraph(left);
  const rightGraph = buildSchematicGraph(right);
  const comparison = compareModules(left, right, leftGraph, rightGraph);

  assert.equal(comparison.left.cells, 2);
  assert.equal(comparison.right.cells, 2);
  assert.equal(comparison.left.logicDepth, 2);
  assert.equal(comparison.right.logicDepth, 1);
  assert.deepEqual(comparison.unmatchedPorts, ["extra"]);
  assert.ok(comparison.commonNets.includes("y"));
  assert.equal(comparison.delta.logicDepth, -1);
  assert.equal(analyzeGraphStats(leftGraph).maxFanout, 1);
});

test("escaped hierarchical output cone resolves through the graph node reference", () => {
  const design = parseVerilog(`module \\root (\\u_dp_add_0/in0 , \\u_dp_add_0/out0_33 );
    input \\u_dp_add_0/in0 ; output \\u_dp_add_0/out0_33 ;
    BUF u0 (.A(\\u_dp_add_0/in0 ), .Z(\\u_dp_add_0/out0_33 )); endmodule`);
  const graph = buildSchematicGraph(design.modules[0]);
  const outputName = "u_dp_add_0/out0_33";
  const outputNode = graph.nodes.find((node) => node.kind === "output" && node.ref?.name === outputName);
  const cone = createConeGraph(graph, outputNode?.id, { direction: "fanin", maxDepth: 3 });

  assert.ok(outputNode);
  assert.notEqual(outputNode.id, `output:${outputName}`);
  assert.equal(cone.nodes.some((node) => node.id === outputNode.id), true);
  assert.equal(cone.nodes.some((node) => node.id === "cell:u0"), true);
});
