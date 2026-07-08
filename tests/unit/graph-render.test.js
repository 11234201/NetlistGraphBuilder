import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { inferCellKind } from "../../src/infer/defaultCellRules.js";
import { layoutGraph } from "../../src/layout/simpleLayered.js";
import { buildSchematicGraph } from "../../src/netlist/graph.js";
import { parseVerilog } from "../../src/parser/verilogParser.js";
import { renderSchematicSvg } from "../../src/render/svgRenderer.js";

const fixtureUrl = new URL("../fixtures/two_equivalent_style_modules.v", import.meta.url);

test("cell inference maps common foundry-like names", () => {
  assert.equal(inferCellKind("ND3X2APAH08HVT30P140").kind, "nand");
  assert.equal(inferCellKind("NR2X1ATPH08HVT30P140").kind, "nor");
  assert.equal(inferCellKind("CKINVX8H08HVT30P140").kind, "inv");
  assert.equal(inferCellKind("XNR2X2AONH08HVT30P140").kind, "xnor");
  assert.equal(inferCellKind("UNKNOWN_CELL").kind, "blackbox");
});

test("graph and svg render fixture module", async () => {
  const source = await readFile(fixtureUrl, "utf8");
  const design = parseVerilog(source);
  const graph = buildSchematicGraph(design.modules[0]);
  const laidOut = layoutGraph(graph);
  const svg = renderSchematicSvg(laidOut);

  assert.ok(graph.nodes.some((node) => node.gateKind === "nand"));
  assert.ok(graph.nodes.some((node) => node.gateKind === "xor"));
  assert.ok(graph.edges.some((edge) => edge.label === "sco_891"));
  assert.match(svg, /<svg class="schematic-svg"/);
  assert.match(svg, /l_resyn3_u_gen_1395/);
});

test("all fixture modules can be converted to renderable graphs", async () => {
  const source = await readFile(fixtureUrl, "utf8");
  const design = parseVerilog(source);

  for (const module of design.modules) {
    const graph = buildSchematicGraph(module);
    const laidOut = layoutGraph(graph);
    const svg = renderSchematicSvg(laidOut);

    assert.ok(graph.nodes.length > 0, `${module.name} should have graph nodes`);
    assert.ok(graph.edges.length > 0, `${module.name} should have graph edges`);
    assert.match(svg, /<svg class="schematic-svg"/);
  }
});

test("unknown cells render as blackboxes", () => {
  const source = "module m(a,y); input a; output y; MYSTERY u0 (.A(a), .Z(y)); endmodule";
  const design = parseVerilog(source);
  const graph = buildSchematicGraph(design.modules[0]);
  const laidOut = layoutGraph(graph);
  const svg = renderSchematicSvg(laidOut);

  assert.ok(graph.nodes.some((node) => node.gateKind === "blackbox"));
  assert.match(svg, /class="node blackbox cell"/);
});
