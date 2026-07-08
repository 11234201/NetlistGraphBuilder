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
