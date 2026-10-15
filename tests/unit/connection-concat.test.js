import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseVerilog } from "../../src/parser/verilogParser.js";
import { getPinNetReferences } from "../../src/netlist/model.js";
import { buildSchematicGraph } from "../../src/netlist/graph.js";
import { createModuleConnectivityTemplate } from "../../src/domains/netlist/hierarchy_connectivity.js";
import { inspectGraphNode } from "../../src/analysis/graphInspector.js";
import { inferCellKind, inferPinDirection } from "../../src/infer/defaultCellRules.js";
import { applyWorkspaceGraphTransforms } from "../../src/app/graphWorkspace.js";
import { layoutGraph } from "../../src/layout/simpleLayered.js";
import { validateLayoutGraph } from "../../src/layout/layoutValidator.js";
import { renderSchematicSvg } from "../../src/domains/netlist/netlist_scene.js";

test("pin concatenations preserve nested order, escaped names, constants and spaced selects", () => {
  const module = parseVerilog(String.raw`module m(a, y);
    input [3:0] a; output y; wire \q[0] ;
    MYSTERY u(.A({a [3], {\q[0] , 1'b0}, a[0]}), .Y(y));
    endmodule`).modules[0];
  const pin = module.cells[0].pins[0];
  assert.equal(pin.net, "");
  assert.equal(pin.connection.kind, "concat");
  assert.equal(pin.connection.items[1].kind, "concat");
  assert.deepEqual(getPinNetReferences(pin).map((ref) => [ref.name, ref.displayName]), [
    ["a[3]", "a[3]"], ["q[0]", "\\q[0]"], ["1'b0", "1'b0"], ["a[0]", "a[0]"]
  ]);
  assert.ok(!module.nets.some((net) => net.name === "{"));
});

test("unsupported pin expressions report a diagnostic instead of silently truncating", () => {
  const module = parseVerilog("module m; MYSTERY u(.A(a & b), .B(a&b), .Y(y)); endmodule").modules[0];
  assert.equal(module.cells[0].pins[0].net, "");
  assert.equal(module.cells[0].pins[0].connection.kind, "unsupported");
  assert.equal(module.cells[0].pins[1].connection.kind, "unsupported");
  assert.equal(module.diagnostics.length, 2);
  assert.deepEqual(getPinNetReferences(module.cells[0].pins[0]), []);
});

test("output concatenations drive each constituent net without mutating source IR", () => {
  const module = parseVerilog("module m(input a, output x, output y); MYSTERY u(.A(a), .Y({x,y})); endmodule").modules[0];
  const original = JSON.stringify(module);
  const graph = buildSchematicGraph(module);
  assert.deepEqual(graph.edges.filter((edge) => edge.source === "cell:u").map((edge) => edge.net).sort(), ["x", "y"]);
  assert.deepEqual(graph.nodes.find((node) => node.id === "cell:u").metadata.outputNets, ["x", "y"]);
  assert.equal(JSON.stringify(module), original);
});

test("tc concatenation terminals complete the full layout and SVG rendering pipeline", async () => {
  const source = await readFile(new URL("../fixtures/tc_unit_generic.v", import.meta.url), "utf8");
  const graph = applyWorkspaceGraphTransforms(buildSchematicGraph(parseVerilog(source).modules[0]));
  const positioned = layoutGraph(graph);
  assert.equal(positioned.layoutStatus, "routed");
  assert.ok(positioned.edges.every((edge) => edge.points?.length >= 2));
  assert.deepEqual(validateLayoutGraph(positioned, { checkObstacles: true, checkBounds: true }), []);
  const svg = renderSchematicSvg(positioned);
  assert.ok(svg.includes("<svg"));
  assert.ok(svg.includes("UNIT_EQ"));
  assert.ok(svg.includes("salt_q"));
});

test("UNIT rules distinguish bitwise inversion from logical and comparison operators", () => {
  for (const [type, kind] of [["UNIT_ADFFR_PN_GATE", "dff"], ["UNIT_AND", "and"],
    ["UNIT_OR", "or"], ["UNIT_NOT", "inv"], ["UNIT_LOGIC_NOT", "blackbox"], ["UNIT_EQ", "blackbox"]]) {
    assert.deepEqual(inferCellKind(type), { kind, source: "rule" });
    assert.equal(inferPinDirection(type === "UNIT_ADFFR_PN_GATE" ? "Q" : "Y", type).direction, "output");
  }
  for (const pin of ["clocked_on", "next_state", "clear"]) {
    assert.deepEqual(inferPinDirection(pin, "UNIT_ADFFR_PN_GATE"), { direction: "input", source: "cell-rule" });
  }
  assert.equal(inferCellKind("UNIT_UNDOCUMENTED").source, "unknown");
});

test("real tc UNIT netlist connects every concatenated register in graphs, templates and inspection", async () => {
  const source = await readFile(new URL("../fixtures/tc_unit_generic.v", import.meta.url), "utf8");
  const module = parseVerilog(source).modules[0];
  const original = JSON.stringify(module);
  const graph = buildSchematicGraph(module);
  assert.equal(module.cells.length, 108);
  assert.equal(graph.nodes.filter((node) => node.gateKind === "dff").length, 97);
  assert.equal(graph.nodes.filter((node) => node.kind === "implicit").length, 0);
  assert.equal(graph.diagnostics.length, 0);
  const u8 = module.cells.find((cell) => cell.instance === "u8");
  assert.deepEqual(getPinNetReferences(u8.pins[1]).map((ref) => ref.name),
    [0, ...Array.from({ length: 31 }, (_, index) => 31 - index)].map((index) => `salt_q[${index}]`));
  for (const [instance, pin, prefix] of [["u8", "A", "b_q"], ["u8", "B", "salt_q"],
    ["u9", "A", "b_q"], ["u9", "B", "salt_q"], ["u11", "B", "salt_q"],
    ["u12", "A", "a_q"], ["u13", "A", "a_q"], ["u13", "B", "salt_q"]]) {
    const edges = graph.edges.filter((edge) => edge.target === `cell:${instance}` && edge.targetPin.startsWith(`${pin}{`));
    assert.equal(edges.length, 32);
    assert.equal(new Set(edges.map((edge) => edge.targetPin)).size, 32);
    assert.deepEqual(new Set(edges.map((edge) => edge.net)),
      new Set(Array.from({ length: 32 }, (_, index) => `${prefix}[${index}]`)));
    assert.ok(edges.every((edge) => graph.nodes.find((node) => node.id === edge.source)?.gateKind === "dff"));
  }
  const template = createModuleConnectivityTemplate(module);
  assert.ok(template.connections.get("salt_q[0]").loads.some((load) => load.localId === "u8" && load.pin === "B"));
  const inspection = inspectGraphNode(graph, graph.nodes.find((node) => node.id === "cell:u8"));
  assert.equal(inspection.connections.filter((connection) => connection.pin.startsWith("A{")).length, 32);
  assert.equal(JSON.stringify(module), original);
});
