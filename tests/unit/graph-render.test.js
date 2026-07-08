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

test("cell input edges connect to distinct pin positions", async () => {
  const source = await readFile(fixtureUrl, "utf8");
  const design = parseVerilog(source);
  const graph = buildSchematicGraph(design.modules[0]);
  const laidOut = layoutGraph(graph);
  const nandInputs = laidOut.edges.filter((edge) => edge.target === "cell:l_resyn3_u_gen_1395");
  const targetYs = new Set(nandInputs.map((edge) => edge.points.at(-1).y));
  const nandOutput = laidOut.edges.find((edge) => edge.source === "cell:l_resyn3_u_gen_1395");
  const nandNode = laidOut.nodes.find((node) => node.id === "cell:l_resyn3_u_gen_1395");

  assert.equal(nandInputs.length, 3);
  assert.equal(targetYs.size, 3);
  assert.equal(nandOutput.points[0].x, nandNode.x + nandNode.width + 10);
});

test("long skip-level input edges route through top wire lanes", async () => {
  const source = await readFile(fixtureUrl, "utf8");
  const design = parseVerilog(source);
  const graph = buildSchematicGraph(design.modules[0]);
  const laidOut = layoutGraph(graph);
  const longEdges = laidOut.edges.filter(
    (edge) =>
      edge.points.some((point) => point.y < Math.min(...laidOut.nodes.map((node) => node.y))) &&
      edge.points.length > 4
  );
  const minNodeY = Math.min(...laidOut.nodes.map((node) => node.y));
  const topLaneYs = new Set(longEdges.map((edge) => Math.min(...edge.points.map((point) => point.y))));
  const sourceLaneXs = new Set(longEdges.map((edge) => edge.points[1].x));
  const targetLaneXs = new Set(longEdges.map((edge) => edge.points.at(-2).x));

  assert.ok(longEdges.length >= 2);
  assert.equal(topLaneYs.size, longEdges.length);
  assert.equal(sourceLaneXs.size, longEdges.length);
  assert.equal(targetLaneXs.size, longEdges.length);
  assert.ok(minGap([...topLaneYs]) >= 16);
  assert.ok(minGap([...sourceLaneXs]) >= 18);
  assert.ok(minGap([...targetLaneXs]) >= 18);
  assert.ok(longEdges.every((edge) => edge.points.some((point) => point.y < minNodeY)));
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

test("svg marks crossing wires with bridges", () => {
  const svg = renderSchematicSvg({
    moduleDisplayName: "crossing",
    width: 220,
    height: 180,
    nodes: [],
    edges: [
      {
        id: "edge:h",
        net: "h",
        label: "h",
        points: [
          { x: 20, y: 80 },
          { x: 180, y: 80 }
        ],
        labelPoint: { x: 90, y: 72 }
      },
      {
        id: "edge:v",
        net: "v",
        label: "v",
        points: [
          { x: 100, y: 30 },
          { x: 100, y: 140 }
        ],
        labelPoint: { x: 104, y: 82 }
      }
    ]
  });

  assert.match(svg, /wire-bridge-cutout/);
  assert.match(svg, /wire-bridge/);
});

test("same-net crossings do not render bridges", () => {
  const svg = renderSchematicSvg({
    moduleDisplayName: "junction",
    width: 220,
    height: 180,
    nodes: [],
    edges: [
      {
        id: "edge:h",
        net: "n",
        label: "n",
        points: [
          { x: 20, y: 80 },
          { x: 180, y: 80 }
        ],
        labelPoint: { x: 90, y: 72 }
      },
      {
        id: "edge:v",
        net: "n",
        label: "n",
        points: [
          { x: 100, y: 30 },
          { x: 100, y: 140 }
        ],
        labelPoint: { x: 104, y: 82 }
      }
    ]
  });

  assert.doesNotMatch(svg, /wire-bridge-cutout/);
});

function minGap(values) {
  const sorted = values.toSorted((left, right) => left - right);
  let gap = Number.POSITIVE_INFINITY;
  for (let index = 1; index < sorted.length; index += 1) {
    gap = Math.min(gap, sorted[index] - sorted[index - 1]);
  }
  return gap;
}
