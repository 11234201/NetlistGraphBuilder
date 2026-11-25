import assert from "node:assert/strict";
import { buildSchematicGraph } from "../../src/netlist/graph.js";
import { parseVerilog } from "../../src/parser/verilogParser.js";
import test from "node:test";
import {
  createModule,
  ensureNet,
  ensurePort,
  getNetDisplayName,
  getPortDisplayName
} from "../../src/netlist/model.js";

test("module name indexes preserve the public IR shape and declaration semantics", () => {
  const module = createModule("indexed");
  const implicit = ensureNet(module, "data", "data", "implicit");
  const declared = ensureNet(module, "data", "\\data", "wire", {
    msb: 3,
    lsb: 0,
    width: 4
  });
  assert.equal(declared.declaredKind, "wire");
  const firstPort = ensurePort(module, "data", "\\data", "input");
  const repeatedPort = ensurePort(module, "data", "data", "output");

  assert.equal(declared, implicit);
  assert.equal(module.nets.length, 1);
  assert.equal(module.nets[0].declaredKind, "port");
  assert.deepEqual(module.nets[0].range, { msb: 3, lsb: 0, width: 4 });
  assert.equal(repeatedPort, firstPort);
  assert.equal(module.ports.length, 1);
  assert.equal(module.ports[0].direction, "output");
  assert.deepEqual(module.portOrder, ["data"]);
  assert.equal(getNetDisplayName(module, "data"), "data");
  assert.equal(getPortDisplayName(module, "data"), "\\data");
  assert.deepEqual(Object.keys(module), [
    "name",
    "displayName",
    "span",
    "portOrder",
    "ports",
    "nets",
    "cells",
    "assigns",
    "diagnostics"
  ]);
});

test("module name indexes rebuild after public IR arrays are replaced or extended", () => {
  const module = createModule("external-mutation");
  ensureNet(module, "a", "a", "wire");
  module.nets.push({ name: "b", displayName: "\\b", declaredKind: "wire" });
  assert.equal(getNetDisplayName(module, "b"), "\\b");

  module.ports = [{ name: "y", displayName: "\\y", direction: "output" }];
  module.portOrder = ["y"];
  assert.equal(getPortDisplayName(module, "y"), "\\y");
  ensurePort(module, "y", "y", "input");
  assert.equal(module.ports.length, 1);
  assert.deepEqual(module.portOrder, ["y"]);
  assert.equal(module.ports[0].direction, "input");
});

test("oversize vectors remain a single reference and escaped ranges remain scalar", () => {
  for (const hi of ["10000000", "99999999999999999"]) {
    const source = "module top(input [" + hi + ":0] a, output y); BUF u(.A(a[" + hi + ":0]),.Y(y)); endmodule";
    const mod = parseVerilog(source).modules[0];
    const graph = buildSchematicGraph(mod);
    assert.equal(graph.nodes.filter((n) => n.kind === "input").length, 1);
    assert.ok(graph.diagnostics.some((d) => d.code === "vector-width-limit" && d.net === "a"));
    assert.ok(graph.diagnostics.some((d) => d.code === "vector-width-limit" && d.net.startsWith("a[")));
  }
  const module = parseVerilog("module top(input \\reg[3:0] ,output y); BUF u(.A(\\reg[3:0] ),.Y(y)); endmodule").modules[0];
  assert.equal(module.cells[0].pins[0].escaped, true);
  assert.deepEqual(module.nets.map((n) => n.name), ["reg[3:0]", "y"]);
  assert.ok(buildSchematicGraph(module).edges.some((e) => e.net === "reg[3:0]"));
});

test("referenced modules in the importing file take priority over matching names elsewhere", () => {
  const module = parseVerilog("module top(input a); T u(.D(a)); endmodule").modules[0];
  module.sourceFile = "local";
  const library = Array.from({ length: 500 }, (_, i) => ({ name: "unrelated" + i }));
  const target = parseVerilog("module T(input D); endmodule").modules[0];
  library.push({ name: "T", sourceFile: "other", ports: [] }, { ...target, name: "T [local]", originalName: "T", sourceFile: "local" });
  const graph = buildSchematicGraph(module, { moduleLibrary: library });
  assert.equal(graph.nodes.find((n) => n.id === "cell:u").pinDirections.D.direction, "input");
});
