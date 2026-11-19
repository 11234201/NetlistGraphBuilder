import assert from "node:assert/strict";
import test from "node:test";
import { parseVerilog } from "../../src/parser/verilogParser.js";
import { buildSchematicGraph } from "../../src/netlist/graph.js";
import { inspectGraphNet } from "../../src/analysis/graphInspector.js";
import { buildWorkspaceGraph } from "../../src/domains/netlist/netlist_graph_projection.js";
import { buildModuleWorkspace } from "../../src/app/moduleWorkspace.js";
import { getLayoutProvider } from "../../src/layout/layoutProvider.js";
import { DEFAULT_LAYOUT_PROVIDER_ID } from "../../src/layout/providerDefaults.js";

const annotatedSource = `
// Ordinary file comment ignored: foo = bar
// module: tc, type = attr, initial_top = true
// module: tc, type = param, OUTW = 256
// module: tc, type = design_constraint, dont_touch = false
// module: tc, type = design_constraint, keep_module = false
module tc (
  fanout_out,
  clk,
  rst_n,
  h_in
);
  input clk;
  input rst_n;
  input [13:13] h_in;
  // bus port: fanout_out[63:0], type = attr, line_no = "xxx"
  output [63:0] fanout_out;

  // net: w_gen_51, type = design_constraint, dont_touch = false
  wire w_gen_51;
  wire \\h_q[13] ;

  // instance: \\h_q_reg[13] , type = attr, line_no = "xxx"
  // instance: \\h_q_reg[13] , type = attr, reg_num = 12
  // instance: \\h_q_reg[13] , type = attr, NEGEDGE = "\\rst_n "
  // instance: \\h_q_reg[13] , type = design_constraint, dont_touch = false
  // instance: \\h_q_reg[13] , type = design_constraint, size_only = false
  xxxxx \\h_q_reg[13]  (.clocked_on(clk),
    .next_state(h_in[13]),
    .clear(rst_n),
    .Q(\\h_q[13] ));

  BUF u_buf (.A(w_gen_51), .Z(fanout_out[0]));
  BUF u_drv (.A(\\h_q[13] ), .Z(w_gen_51));
endmodule

module top (
  input clk,
  input rst_n,
  input [13:13] h_in,
  output [63:0] fanout_out
);
  // instance: u_tc, type = attr, custom_tag = "top_inst"
  tc u_tc (.clk(clk), .rst_n(rst_n), .h_in(h_in), .fanout_out(fanout_out));
endmodule
`;

test("parser extracts module, bus port, net, and escaped instance comment attributes accurately", () => {
  const design = parseVerilog(annotatedSource);
  assert.equal(design.modules.length, 2);
  const tc = design.modules[0];

  assert.deepEqual(
    tc.attributes.map(({ category, key, value }) => [category, key, value]),
    [
      ["attr", "initial_top", "true"],
      ["param", "OUTW", "256"],
      ["design_constraint", "dont_touch", "false"],
      ["design_constraint", "keep_module", "false"]
    ]
  );

  const fanoutPort = tc.ports.find((p) => p.name === "fanout_out");
  assert.deepEqual(
    fanoutPort.attributes.map(({ category, key, value }) => [category, key, value]),
    [["attr", "line_no", "xxx"]]
  );

  const net = tc.nets.find((n) => n.name === "w_gen_51");
  assert.deepEqual(
    net.attributes.map(({ category, key, value }) => [category, key, value]),
    [["design_constraint", "dont_touch", "false"]]
  );

  const inst = tc.cells.find((c) => c.instance === "h_q_reg[13]");
  assert.ok(inst);
  assert.deepEqual(
    inst.attributes.map(({ category, key, value }) => [category, key, value]),
    [
      ["attr", "line_no", "xxx"],
      ["attr", "reg_num", "12"],
      ["attr", "NEGEDGE", "\\rst_n "],
      ["design_constraint", "dont_touch", "false"],
      ["design_constraint", "size_only", "false"]
    ]
  );

  const top = design.modules[1];
  assert.equal(top.attributes, undefined, "comments from tc must not bleed into top");
});

test("graph propagates module, expanded bus port, net, and hinst referenced-module attributes without changing layout", async () => {
  const design = parseVerilog(annotatedSource);
  const [tc, top] = design.modules;
  const tcGraph = buildSchematicGraph(tc, { moduleLibrary: design.modules });
  const topGraph = buildSchematicGraph(top, { moduleLibrary: design.modules });

  assert.equal(tcGraph.moduleAttributes.length, 4);
  assert.equal(tcGraph.netAttributes.w_gen_51.length, 1);
  const fanoutBit0 = tcGraph.nodes.find((n) => n.kind === "output" && n.ref?.name === "fanout_out[0]");
  assert.ok(fanoutBit0);
  assert.deepEqual(fanoutBit0.ref.attributes.map((a) => [a.key, a.value]), [["line_no", "xxx"]]);

  const hinstNode = topGraph.nodes.find((n) => n.id === "cell:u_tc");
  assert.equal(hinstNode.referencedModuleName, "tc");
  assert.deepEqual(hinstNode.ref.attributes.map((a) => [a.key, a.value]), [["custom_tag", "top_inst"]]);
  assert.equal(hinstNode.referencedModuleAttributes.length, 4);

  const plainSource = annotatedSource.replace(/^\s*\/\/.*$/gm, "");
  const plainTc = parseVerilog(plainSource).modules[0];
  const provider = getLayoutProvider(DEFAULT_LAYOUT_PROVIDER_ID);
  const withAttrs = await buildModuleWorkspace({ module: tc, moduleLibrary: design.modules, layoutProvider: provider });
  const withoutAttrs = await buildModuleWorkspace({ module: plainTc, moduleLibrary: [plainTc], layoutProvider: provider });
  assert.deepEqual(
    withAttrs.graph.nodes.map((n) => [n.id, n.x, n.y, n.width, n.height]),
    withoutAttrs.graph.nodes.map((n) => [n.id, n.x, n.y, n.width, n.height])
  );
});

test("single-bit bus net attributes isolate to the addressed bit and quoted values ending in escaped backslashes split cleanly", () => {
  const source = `
module bit_net_mod (input [7:0] d, output [7:0] q);
  // net: bus_w[3], type = attr, bit_only = true
  wire [7:0] bus_w;
  // instance: u0, type = attr, path = "dir\\\\", flag = true
  BUF u0 (.A(d[3]), .Y(bus_w[3]));
  BUF u1 (.A(d[2]), .Y(bus_w[2]));
  BUF u2 (.A(bus_w[3]), .Y(q[3]));
  BUF u3 (.A(bus_w[2]), .Y(q[2]));
endmodule`;
  const [mod] = parseVerilog(source).modules;
  const graph = buildSchematicGraph(mod);
  const bit3 = inspectGraphNet(graph, "bus_w[3]");
  const bit2 = inspectGraphNet(graph, "bus_w[2]");
  assert.deepEqual(bit3.attributes.map((a) => [a.key, a.value]), [["bit_only", "true"]]);
  assert.deepEqual(bit2.attributes, []);

  const inst = mod.cells.find((c) => c.instance === "u0");
  assert.deepEqual(
    inst.attributes.map(({ key, value }) => [key, value]),
    [["path", "dir\\\\"], ["flag", "true"]]
  );
});

test("supports escaped bus bit targets, pre-module comments, and alias-collapsed net attribute lookup", () => {
  const source = `
// port: \\esc_bus [2], type = attr, pre_module = ok
module esc_mod (input [3:0] \\esc_bus , output [3:0] out_q);
  // net: \\esc_net[1] , type = attr, esc_bit = yes
  // net: raw_w, type = design_constraint, keep = true
  wire [3:0] \\esc_net ;
  wire raw_w;
  wire alias_w;
  assign alias_w = raw_w;
  BUF u_pre (.A(\\esc_bus [2]), .Y(\\esc_net [1]));
  BUF u_drv (.A(\\esc_net [1]), .Y(raw_w));
  BUF u_load (.A(alias_w), .Y(out_q[0]));
endmodule`;
  const [mod] = parseVerilog(source).modules;
  const workspaceGraph = buildWorkspaceGraph(mod, { showAliases: false });
  const prePort = workspaceGraph.nodes.find((n) => n.kind === "input" && n.ref?.name === "esc_bus[2]");
  const otherPort = workspaceGraph.nodes.find((n) => n.kind === "input" && n.ref?.name === "esc_bus[1]");
  assert.deepEqual(prePort.ref.attributes.map((a) => [a.key, a.value]), [["pre_module", "ok"]]);
  assert.equal(otherPort.ref.attributes?.length || 0, 0);

  const escNet1 = inspectGraphNet(workspaceGraph, "esc_net[1]");
  const escNet2 = inspectGraphNet(workspaceGraph, "esc_net[2]");
  assert.deepEqual(escNet1.attributes.map((a) => [a.key, a.value]), [["esc_bit", "yes"]]);
  assert.deepEqual(escNet2.attributes, []);

  const rawNet = inspectGraphNet(workspaceGraph, "raw_w");
  const aliasNet = inspectGraphNet(workspaceGraph, "alias_w");
  assert.deepEqual(rawNet.attributes.map((a) => [a.key, a.value]), [["keep", "true"]]);
  assert.deepEqual(aliasNet.attributes.map((a) => [a.key, a.value]), [["keep", "true"]]);
});
