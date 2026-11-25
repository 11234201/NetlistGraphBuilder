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

test("unit directives apply to subsequent records within a multi-module timing file", () => {
  for (const [first, second, scale] of [["ns", "ps", 0.001], ["ps", "ns", 1000]]) {
    const fileName = "scopes.txt";
    const source = [
      "@module left", "@unit " + first, "point at rt slack delay slew", "u/Y 1 2 - - 3",
      "@module right", "@unit " + second, "v/Y 250 750 - 40 30"
    ].join("\n");
    const { timing } = importTimingSource(source, { name: fileName });
    assert.equal(timing.unit, first);
    assert.deepEqual(timing.scopes.left.map(({ at, rt, slack, delay, slew }) => [at, rt, slack, delay, slew]),
      [[1, 2, 1, null, 3]]);
    const [record] = timing.scopes.right;
    assert.deepEqual([record.at, record.rt, record.slack, record.delay, record.slew],
      [250, 750, 500, 40, 30].map((value) => value * scale));
    assert.equal(record.slackDerived, true);
    assert.equal(record.fileName, fileName);
    assert.equal(record.line, 7);
    assert.throws(() => importTimingSource(source + "\n@unit ticks", { name: fileName }), (error) => {
      const [diagnostic] = error.diagnostic.diagnosticExamples;
      return diagnostic.code === "unknown-unit" && diagnostic.fileName === fileName &&
        diagnostic.line === 8 && diagnostic.scope === "right";
    });
  }
});
