import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseVerilog, tokenize } from "../../src/parser/verilogParser.js";

const fixtureUrl = new URL("../fixtures/two_equivalent_style_modules.v", import.meta.url);

test("tokenizer preserves escaped identifiers", () => {
  const tokens = tokenize("input \\a_q[25] ;");
  const escaped = tokens.find((token) => token.escaped);

  assert.equal(escaped.value, "a_q[25]");
  assert.equal(escaped.displayName, "\\a_q[25]");
});

test("tokenizer separates a packed range from an adjacent declaration name", () => {
  const tokens = tokenize("output [ 0 : 0 ]y_out;")
    .filter((token) => token.kind !== "eof")
    .map((token) => token.value);

  assert.deepEqual(tokens, ["output", "[0:0]", "y_out", ";"]);
});

test("parser reads fixture modules and structural statements", async () => {
  const source = await readFile(fixtureUrl, "utf8");
  const design = parseVerilog(source);

  assert.equal(design.modules.length, 2);
  assert.equal(design.diagnostics.length, 0);

  const first = design.modules[0];
  assert.equal(first.cells.length, 5);
  assert.equal(first.assigns.length, 0);
  assert.equal(first.ports.filter((port) => port.direction === "input").length, 8);
  assert.equal(first.ports.filter((port) => port.direction === "output").length, 1);
  assert.ok(first.ports.some((port) => port.displayName === "\\a_q[25]"));

  const flex = design.modules[1];
  assert.equal(flex.cells.length, 6);
  assert.equal(flex.assigns.length, 1);
  assert.equal(flex.assigns[0].lhs, "sco_891");
  assert.equal(flex.assigns[0].rhs, "sco_925");
});

test("parser preserves packed ranges on ports and wires", () => {
  const design = parseVerilog(`module vector_ports(a, y);
input [3:0] a;
output [0:1] y;
wire [7:4] n;
endmodule`);
  const module = design.modules[0];

  assert.deepEqual(module.ports.find((port) => port.name === "a").range, {
    msb: 3,
    lsb: 0,
    width: 4
  });
  assert.deepEqual(module.ports.find((port) => port.name === "y").range, {
    msb: 0,
    lsb: 1,
    width: 2
  });
  assert.deepEqual(module.nets.find((net) => net.name === "n").range, {
    msb: 7,
    lsb: 4,
    width: 4
  });
});

test("parser supports packed ranges in ANSI-style module headers", () => {
  const module = parseVerilog(`module ansi_vector(
  input logic [7:0] a, b,
  output [0:1] y
); endmodule`).modules[0];

  assert.deepEqual(module.ports.map((port) => [port.name, port.direction, port.range]), [
    ["a", "input", { msb: 7, lsb: 0, width: 8 }],
    ["b", "input", { msb: 7, lsb: 0, width: 8 }],
    ["y", "output", { msb: 0, lsb: 1, width: 2 }]
  ]);
});

test("packed declarations, bit selects and escaped names are insensitive to optional whitespace", () => {
  const [module] = parseVerilog([
    "module packed(input[3:0]a, output wire[0:1]y);",
    "wire[3:0]w; wire \\literal[2] ;",
    "BUF u(.A(a[ 2 ]), .Y(w[2]));",
    "assign y[0] = \\literal[2] ;",
    "wire[200000:0]oversize;",
    "endmodule"
  ].join("\n")).modules;
  assert.deepEqual(module.ports.map(({ name, direction, range }) => [name, direction, range?.width]),
    [["a", "input", 4], ["y", "output", 2]]);
  assert.equal(module.nets.find(({ name }) => name === "w")?.range?.width, 4);
  assert.ok(module.nets.find(({ name }) => name === "literal[2]")?.escaped);
  assert.deepEqual(module.cells[0].pins.map(({ net }) => net), ["a[2]", "w[2]"]);
  assert.deepEqual(module.assigns.map(({ lhs, rhs }) => [lhs, rhs]), [["y[0]", "literal[2]"]]);
  assert.deepEqual(module.diagnostics.map(({ code, moduleName, net, span }) => [code, moduleName, net, span]),
    [["vector-width-limit", "packed", "oversize", { line: 5, column: 15 }]]);
});

test("structural attributes and escaped keywords preserve neighboring declarations and instances", () => {
  const [module, next] = parseVerilog([
    '(* note = "*)" *) module \\wire  #(parameter W=8)(input \\reg , (* keep *) output \\signed );',
    '(* keep *) wire \\input ; (* keep *) assign \\input = \\reg ;',
    '(* keep *) \\endmodule \\wire (.A(\\input ), .Y(\\signed ));',
    'wire a = b, c; reg x; logic z; supply0 g; supply1 v;',
    'BUF positional(\\reg , \\signed ); endmodule', 'module next(); endmodule'
  ].join("\n")).modules;
  assert.equal(next.name, "next");
  assert.deepEqual(module.ports.map((port) => port.name), ["reg", "signed"]);
  assert.equal(module.cells.length, 1);
  assert.equal(module.cells[0].type, "endmodule");
  assert.equal(module.assigns[0].lhs, "input");
  assert.ok(module.nets.some((net) => net.name === "c"));
  assert.ok(!module.nets.some((net) => net.name === "b"));
  assert.deepEqual(module.diagnostics.map((d) => d.code), ["unsupported-parameter-list",
    "unsupported-inline-assignment", ...Array(4).fill("unsupported-declaration"), "unsupported-positional-ports"]);
  assert.ok(module.diagnostics.every((d) => d.moduleName === "wire" && d.span.line && d.span.column));
});

test("an unterminated bit select preserves the next pin, instance and module", () => {
  const [first, next] = parseVerilog([
    "module first(input a, output y);",
    "BUF broken(.A(a[0), .Y(y));",
    "wire[3:0;", "BUF good(.A(a), .Y(y)); endmodule",
    "module next(); endmodule"
  ].join("\n")).modules;
  assert.equal(next?.name, "next");
  assert.deepEqual(first.cells.map(({ instance }) => instance), ["broken", "good"]);
  assert.equal(first.cells[0].pins[1].net, "y");
  assert.deepEqual(first.diagnostics.map(({ code, moduleName, span }) => [code, moduleName, span]),
    [["unsupported-pin-expression", "first", { line: 2, column: 13 }],
      ["unterminated-range", "first", { line: 3, column: 5 }]]);
});

test("attached ranges retain structural instance names and do not change the next wire declaration", () => {
  const [module] = parseVerilog([
    "module top(input x, output y);",
    "wire bank[3:0], scalar;",
    "BUF b[1:0](.A(x),.Y(y)), c[3:2](.A(x),.Y(scalar));",
    "endmodule"
  ].join("\n")).modules;
  assert.deepEqual(module.cells.map(({ instance, instanceDisplayName, pins }) =>
    [instance, instanceDisplayName, pins.map(({ net }) => net)]),
    [["b[1:0]", "b[1:0]", ["x", "y"]], ["c[3:2]", "c[3:2]", ["x", "scalar"]]]);
  assert.ok(module.nets.some(({ name }) => name === "bank[3:0]"));
  assert.equal(module.nets.find(({ name }) => name === "scalar").range ?? null, null);
});

test("wildcard event controls preserve subsequent cells, modules and attribute diagnostics", () => {
  const diagnostics = [];
  assert.deepEqual(tokenize("(*)", [], diagnostics).slice(0, -1).map(token => token.value), ["(", "*", ")"]);
  assert.deepEqual(diagnostics, []);
  const design = parseVerilog([
    "module proc(input a, output y);",
    "always@(*) q = a;",
    "always @ /* sensitivity */ (* ) r = a;",
    '(* keep = "true" *) BUF b(.A(a),.Y(y)); endmodule',
    "module next(); endmodule", "(* unclosed"
  ].join("\n"));
  assert.deepEqual(design.modules.map(({ name }) => name), ["proc", "next"]);
  assert.deepEqual(design.modules[0].cells.map(({ instance }) => instance), ["b"]);
  assert.deepEqual(design.diagnostics.map(({ code, line, column }) => [code, line, column]),
    [["unterminated-attribute", 6, 1]]);
});
