import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createProcessLog, filterProcessLogEntries } from "../../src/app/processLog.js";
import { LOG_DETAIL_LIMITS } from "../../src/foundation/log_details.js";

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

test("persistence and runtime remain distinct filterable phases", () => {
  const log = createProcessLog();
  for (const phase of ["persistence", "runtime", "graph"]) log.append({ level: "error", phase, message: phase });
  assert.deepEqual(log.entries({ phase: "persistence" }).map((entry) => entry.message), ["persistence"]);
  assert.deepEqual(log.entries({ phase: "runtime" }).map((entry) => entry.message), ["runtime"]);
});

test("error snapshots preserve stack, cause and provider diagnostics without retaining inputs", () => {
  const log = createProcessLog();
  const error = new Error("routing failed", { cause: new Error("invalid port") });
  error.code = "P5_FAILED";
  error.diagnostic = { phase: "p5", entityIds: ["cell:a"], detail: { invariant: "orthogonal", token: "secret-value" } };
  const entry = log.append({ level: "error", phase: "layout", details: { error, moduleName: "top", requestId: 7 } });
  assert.equal(entry.details.error.stack, error.stack);
  assert.equal(entry.details.error.cause.message, "invalid port");
  assert.equal(entry.details.error.code, "P5_FAILED");
  assert.deepEqual(entry.details.error.diagnostic.entityIds, ["cell:a"]);
  assert.doesNotMatch(log.toJsonLines(), /secret-value/);
  error.diagnostic.entityIds.push("later");
  entry.details.error.diagnostic.entityIds.push("caller");
  log.entries()[0].details.error.diagnostic.entityIds.push("reader");
  assert.deepEqual(log.entries()[0].details.error.diagnostic.entityIds, ["cell:a"]);
});

test("diagnostics are recursively redacted, bounded and safe for cyclic or hostile values", () => {
  const log = createProcessLog();
  const details = { big: 123n, nested: { rawText: "raw-secret", configText: "config-secret", password: "password-secret" } };
  details.self = details;
  Object.defineProperty(details, "unreadable", { enumerable: true, get() { throw new Error("getter"); } });
  details.array = [{ accessToken: "array-secret", keep: true }];
  details.huge = Array.from({ length: 10000 }, () => "x".repeat(10000));
  details.toJSON = () => { throw new Error("toJSON must not run"); };
  log.append({ phase: "runtime", details });
  const exported = log.toJsonLines();
  const saved = JSON.parse(exported).details;
  assert.equal(saved.self, "[Circular]");
  assert.equal(saved.big, "123");
  assert.equal(saved.unreadable, "[Unreadable]");
  assert.deepEqual(saved.array, [{ keep: true }]);
  assert.doesNotMatch(exported, /raw-secret|config-secret|password-secret|array-secret/);
  assert.match(exported, /Truncated/);
  assert.ok(exported.length < LOG_DETAIL_LIMITS.characters + 4096);
  assert.doesNotThrow(() => log.append({ details: new Proxy({}, { ownKeys() { throw new Error("proxy"); } }) }));
});

test("cross-realm Error objects retain their non-enumerable diagnostics", () => {
  const error = runInNewContext("new Error('iframe failure')");
  const log = createProcessLog();
  log.append({ level: "error", phase: "runtime", details: { error } });
  assert.equal(log.entries()[0].details.error.stack, error.stack);
});
