import assert from "node:assert/strict";
import test from "node:test";
import { importTimingSource } from "../../src/domains/netlist/timing_import.js";

test("timing import validates input and returns an immutable application result", () => {
  const source = "@module top\npoint at rt slack\nu0/A 1.0 0.1 -0.2";
  const imported = importTimingSource(source, { name: "run.log" });
  assert.equal(imported.source.name, "run.log");
  assert.equal(imported.source.size, source.length);
  assert.equal(imported.summary.recordCount, 1);
  assert.equal(imported.summary.instanceCount, 1);
  assert.equal(imported.summary.format, "tabular");
  assert.equal(Object.isFrozen(imported), true);
  assert.throws(() => importTimingSource(new Uint8Array()), /must be text/);
  assert.throws(() => importTimingSource("unrecognized"), /no timing scope/);
});
