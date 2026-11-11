import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
function execute(t, script, { unavailable = false } = {}) {
  const temporary = mkdtempSync(join(tmpdir(), "ngb-log-unit-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const logs = join(temporary, "logs");
  if (unavailable) writeFileSync(logs, "not a directory");
  const result = spawnSync(process.execPath, ["--input-type=module", "-e",
    'import { createTerminalLog } from "./tools/terminal_log.mjs";\n' + script.join("\n")], {
    cwd: root, encoding: "utf8", timeout: 10000,
    env: { ...process.env, NGB_LOG_DIR: logs, NGB_LOG_MAX_BYTES: "1024" }
  });
  assert.equal(result.status, 0, result.stderr);
  const files = unavailable ? [] : readdirSync(logs).filter((name) => statSync(join(logs, name)).isFile());
  const read = (kind) => files.filter((name) => name.includes("." + kind + ".jsonl"))
    .flatMap((name) => readFileSync(join(logs, name), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse));
  return { ...result, logs, files, read };
}

test("terminal logs retain nested errors, redact inputs, and keep stdout available for the protocol", (t) => {
  const result = execute(t, [
    'const log = createTerminalLog("test");',
    'const error = new Error("write failed", { cause: new Error("disk full") });',
    'error.code = "ENOSPC";',
    'log.error("save.failed", error, { source: "private netlist", password: "private password" });',
    'console.log(JSON.stringify({ event: "ready" }));'
  ]);
  assert.deepEqual(result.stdout.trim().split("\n").map(JSON.parse), [{ event: "ready" }]);
  const [entry] = result.read("error");
  assert.equal(entry.details.error.code, "ENOSPC");
  assert.match(entry.details.error.stack, /write failed/);
  assert.equal(entry.details.error.cause.message, "disk full");
  assert.doesNotMatch(JSON.stringify(result.read("run")) + result.stderr, /private netlist|private password/);
});

test("terminal rotation keeps recent records and error files only contain errors", (t) => {
  const result = execute(t, [
    'const log = createTerminalLog("test");',
    'for (let index = 0; index < 30; index++) log.write("info", "progress", "step " + index, {}, false);',
    'log.error("last.failure", new Error("last error"));'
  ]);
  assert.ok(result.files.some((name) => name.endsWith(".run.jsonl.1")));
  assert.equal(result.files.length, 3);
  assert.ok(result.read("run").some((item) => item.event === "last.failure"));
  assert.ok(result.read("error").every((item) => item.level === "error"));
});

test("an unavailable log destination reports once and retains diagnostics on stderr", (t) => {
  const result = execute(t, [
    'const log = createTerminalLog("test");',
    'log.write("info", "one", "still alive", {}, false);',
    'log.error("two", new Error("actual failure"));'
  ], { unavailable: true });
  const entries = result.stderr.trim().split("\n").map(JSON.parse);
  assert.equal(entries.filter((item) => item.event === "log.write_failed").length, 1);
  assert.ok(entries.some((item) => item.event === "one"));
  assert.ok(entries.some((item) => item.event === "two"));
});

test("a log destination that fails during rotation does not mask the operation", (t) => {
  const result = execute(t, [
    'import { mkdirSync } from "node:fs";',
    'const log = createTerminalLog("test");',
    'mkdirSync(log.files.run + ".1");',
    'for (let index = 0; index < 12; index++) log.write("info", "progress", "step " + index, {}, false);',
    'log.error("operation.failed", new Error("original error"));'
  ]);
  const entries = result.stderr.trim().split("\n").map(JSON.parse);
  assert.equal(entries.filter((item) => item.event === "log.write_failed").length, 1);
  assert.equal(entries.at(-1).details.error.message, "original error");
});
