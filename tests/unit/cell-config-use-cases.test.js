import assert from "node:assert/strict";
import test from "node:test";
import { createCellConfigUseCases } from "../../src/application/cell_config_use_cases.js";
import { createEmptyCellConfig } from "../../src/infer/cellConfig.js";

const definition = { displayName: "X", gateKind: "BUF", pins: { A: "input", Z: "output" } };

test("Cell Config use cases validate before one explicit persistence commit", () => {
  const saved = [];
  const useCases = createCellConfigUseCases({ save: (bundle) => (saved.push(bundle), bundle) });
  const configured = useCases.set(createEmptyCellConfig(), "X", definition);
  assert.equal(configured.cells.X.gateKind, "BUF");
  const prepared = useCases.prepareImport(configured, {
    kind: "netlist-cell-config",
    version: 1,
    cells: { X: { ...definition, gateKind: "INV" }, Y: definition }
  });
  assert.deepEqual(prepared.conflicts, ["X"]);
  assert.equal(saved.length, 1, "preparing a conflict must not persist before confirmation");
  const imported = useCases.commitImport(prepared);
  assert.equal(imported.cells.X.gateKind, "INV");
  assert.equal(saved.length, 2);
  assert.equal(useCases.remove(imported, "Y").cells.Y, undefined);
  assert.deepEqual(useCases.reset().cells, {});
});

test("Cell Config use cases reject malformed input before persistence", () => {
  let saves = 0;
  const useCases = createCellConfigUseCases({ save: (bundle) => (saves += 1, bundle) });
  assert.throws(() => useCases.prepareImport(createEmptyCellConfig(), "{broken"));
  assert.equal(saves, 0);
  assert.throws(() => createCellConfigUseCases({}), /require save/);
});
