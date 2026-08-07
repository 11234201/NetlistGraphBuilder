import assert from "node:assert/strict";
import test from "node:test";
import {
  CELL_CONFIG_STORAGE_KEY,
  createEmptyCellConfig,
  loadStoredCellConfig,
  mergeCellConfigs,
  parseCellConfig,
  removeCellConfigDefinition,
  saveStoredCellConfig,
  serializeCellConfig,
  setCellConfigDefinition
} from "../../src/infer/cellConfig.js";
import { buildSchematicGraph } from "../../src/netlist/graph.js";
import { parseVerilog } from "../../src/parser/verilogParser.js";

const configSource = {
  kind: "netlist-cell-config",
  version: 1,
  cells: {
    Z_CUSTOM: { displayName: "Z_CUSTOM", gateKind: "BLACKBOX", pins: { Z: "output", A: "input" } },
    MYCELL: { displayName: "My cell", gateKind: "NAND", pins: { Y: "output", A: "input", B: "input" } }
  }
};

test("Cell Config validates, canonicalizes and exports deterministically", () => {
  const parsed = parseCellConfig(configSource);
  assert.deepEqual(Object.keys(parsed.cells), ["MYCELL", "Z_CUSTOM"]);
  assert.deepEqual(Object.keys(parsed.cells.MYCELL.pins), ["A", "B", "Y"]);
  assert.equal(serializeCellConfig(parsed), serializeCellConfig(JSON.parse(serializeCellConfig(parsed))));
  assert.throws(() => parseCellConfig({ ...configSource, version: 2 }), /Unsupported/);
  assert.throws(() => parseCellConfig({ ...configSource, extra: true }), /unknown field/);
  assert.throws(() => parseCellConfig({ ...configSource, cells: { X: { gateKind: "CODE", pins: {} } } }), /gate kind/);
  assert.throws(() => parseCellConfig({ ...configSource, cells: { X: { gateKind: "BUF", pins: { A: "sideways" } } } }), /pin direction/);
});

test("user Cell Config drives unknown cell kind and pins without replacing submodules", () => {
  const design = parseVerilog(`
    module MYCELL(input A, input B, output Y); assign Y = A; endmodule
    module top(input a, input b, output y, output z);
      MYCELL hierarchical (.A(a), .B(b), .Y(y));
      Z_CUSTOM primitive (.A(a), .Z(z));
    endmodule
  `);
  const top = design.modules.find((item) => item.name === "top");
  const graph = buildSchematicGraph(top, { moduleLibrary: design.modules, cellConfig: parseCellConfig(configSource) });
  const hierarchical = graph.nodes.find((node) => node.label === "hierarchical");
  assert.equal(hierarchical.gateKind, "module");
  assert.equal(hierarchical.inferenceSource, "module-definition");
  const primitive = graph.nodes.find((node) => node.label === "primitive");
  assert.equal(primitive.gateKind, "blackbox");
  assert.equal(primitive.inferenceSource, "user-config");
  assert.deepEqual(primitive.pinDirections.Z, { direction: "output", source: "user-config" });
});

test("Cell Config persistence keeps the last valid bundle", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
  const saved = saveStoredCellConfig(configSource, storage);
  assert.equal(loadStoredCellConfig(storage).cells.MYCELL.gateKind, "NAND");
  values.set(CELL_CONFIG_STORAGE_KEY, "{broken");
  assert.deepEqual(loadStoredCellConfig(storage), createEmptyCellConfig());
  assert.equal(saved.kind, "netlist-cell-config");
});

test("Cell Config updates, deletes and reports import conflicts immutably", () => {
  const empty = createEmptyCellConfig();
  const one = setCellConfigDefinition(empty, "X", { displayName: "X", gateKind: "BUF", pins: { A: "input", Z: "output" } });
  assert.equal(Object.keys(empty.cells).length, 0);
  assert.equal(one.cells.X.gateKind, "BUF");
  const merged = mergeCellConfigs(one, parseCellConfig({ ...configSource, cells: { X: { displayName: "X2", gateKind: "INV", pins: { Z: "output" } } } }));
  assert.deepEqual(merged.conflicts, ["X"]);
  assert.equal(merged.bundle.cells.X.gateKind, "INV");
  assert.equal(Object.keys(removeCellConfigDefinition(merged.bundle, "X").cells).length, 0);
});
