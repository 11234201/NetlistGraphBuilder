import assert from "node:assert/strict";
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
