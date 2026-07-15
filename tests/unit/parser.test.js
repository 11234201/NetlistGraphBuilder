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
