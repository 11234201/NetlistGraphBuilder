import assert from "node:assert/strict";
import test from "node:test";
import { createProcessLog, filterProcessLogEntries } from "../../src/app/processLog.js";

test("process log keeps a fixed-capacity ordered buffer", () => {
  let tick = 0;
  const log = createProcessLog({ capacity: 3, clock: () => new Date(tick++ * 1000) });
  for (let index = 0; index < 5; index += 1) {
    log.append({ level: "info", phase: "graph", message: `entry-${index}` });
  }

  assert.equal(log.size, 3);
  assert.deepEqual(log.entries().map((entry) => entry.message), ["entry-2", "entry-3", "entry-4"]);
  assert.deepEqual(log.entries().map((entry) => entry.sequence), [3, 4, 5]);
});

test("process log merges only adjacent progress for the same phase and key", () => {
  const log = createProcessLog({ capacity: 10, clock: () => new Date(0) });
  log.progress({ level: "debug", phase: "render", key: "svg", message: "1/10", details: { rendered: 1 } });
  log.progress({ level: "debug", phase: "render", key: "svg", message: "5/10", details: { rendered: 5 } });
  log.progress({ level: "debug", phase: "layout", key: "svg", message: "layout 1/2" });
  log.progress({ level: "debug", phase: "render", key: "svg", message: "10/10" });

  assert.equal(log.size, 3);
  assert.deepEqual(log.entries().map((entry) => entry.message), ["5/10", "layout 1/2", "10/10"]);
  assert.equal(log.entries()[0].sequence, 1);
});

test("process log filters entries and omits sensitive detail fields", () => {
  const input = {
    level: "error",
    phase: "parse",
    message: "Parse failed",
    details: {
      fileName: "design.v",
      source: "module secret; endmodule",
      rawText: "private",
      accessToken: "credential"
    }
  };
  const log = createProcessLog({ clock: () => new Date(0) });
  log.append(input);
  log.append({ level: "info", phase: "export", message: "done" });

  const filtered = filterProcessLogEntries(log.entries(), { level: "error", phase: "parse" });
  assert.equal(filtered.length, 1);
  assert.deepEqual(filtered[0].details, { fileName: "design.v" });
  assert.match(log.toJsonLines({ phase: "parse" }), /Parse failed/);
  assert.doesNotMatch(log.toJsonLines(), /module secret|private|credential/);
  assert.equal(input.details.source, "module secret; endmodule");
});

test("clearing the process log removes entries without reusing sequence numbers", () => {
  const log = createProcessLog({ clock: () => new Date(0) });
  log.append({ phase: "import", message: "first" });
  log.clear();
  const entry = log.append({ phase: "import", message: "second" });
  assert.equal(log.size, 1);
  assert.equal(entry.sequence, 2);
});
