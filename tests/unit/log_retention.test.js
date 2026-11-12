import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, existsSync, symlinkSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupTerminalLogs } from "../../tools/log_retention.mjs";

const day = 86400000;
const deadPid = 2147483647;
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "ngb-retention-unit-"));
  t.after(() => { chmodSync(directory, 0o700); rmSync(directory, { recursive: true, force: true }); });
  const now = Math.floor(Date.now() / 1000) * 1000;
  t.mock.method(Date, "now", () => now);
  function file(name, age = 30) {
    const path = join(directory, name);
    writeFileSync(path, "{}\n");
    utimesSync(path, new Date(now - age * day), new Date(now - age * day));
    return path;
  }
  return { directory, file };
}

test("retention deletes expired inactive sessions including all runtimes and rolling backups", (t) => {
  const { directory, file } = fixture(t);
  const paths = [];
  for (const runtime of ["bash", "node", "python", "native", "windows"]) {
    for (const suffix of ["run.jsonl", "error.jsonl", "run.jsonl.1", "error.jsonl.1"]) {
      paths.push(file(runtime + "-1-" + deadPid + "." + suffix));
    }
  }
  const result = cleanupTerminalLogs(directory);
  assert.deepEqual(result, { retentionDays: 14, deletedFiles: 20, deletedBytes: 60, failedFiles: 0 });
  assert.ok(paths.every((path) => !existsSync(path)));
});

test("retention preserves live PIDs, recent siblings and files exactly at the cutoff", (t) => {
  const { directory, file } = fixture(t);
  const paths = [
    file("node-1-" + process.pid + ".run.jsonl"),
    file("node-2-" + deadPid + ".run.jsonl", 1),
    file("node-2-" + deadPid + ".error.jsonl.1"),
    file("node-3-" + deadPid + ".run.jsonl", 14)
  ];
  assert.equal(cleanupTerminalLogs(directory).deletedFiles, 0);
  assert.ok(paths.every(existsSync));
});

test("retention ignores unrelated names, unsafe PIDs, directories, and symlink sessions", (t) => {
  const { directory, file } = fixture(t);
  const paths = [
    file("notes.txt"), file("test-1-" + deadPid + ".run.jsonl"),
    file("node-1-0.run.jsonl"), file("node-1-9999999999.run.jsonl"),
    file("node-1-" + deadPid + ".run.jsonl.2")
  ];
  const nested = join(directory, "python-1-" + deadPid + ".run.jsonl");
  mkdirSync(nested);
  paths.push(file("python-1-" + deadPid + ".error.jsonl"), file("outside.txt"));
  if (process.platform !== "win32") {
    symlinkSync(paths.at(-1), join(directory, "native-1-" + deadPid + ".run.jsonl"));
    paths.push(file("native-1-" + deadPid + ".error.jsonl"));
  }
  assert.equal(cleanupTerminalLogs(directory).deletedFiles, 0);
  assert.ok(paths.every(existsSync));
  assert.ok(existsSync(nested));
});

test("retention supports disabling and custom days; invalid values use the default", (t) => {
  const { directory, file } = fixture(t);
  const old = file("node-1-" + deadPid + ".run.jsonl");
  assert.equal(cleanupTerminalLogs(directory, "0").deletedFiles, 0);
  assert.ok(existsSync(old));
  assert.equal(cleanupTerminalLogs(directory, "2").deletedFiles, 1);
  for (const value of ["", "-1", "3651", "1.5", "0\n", "Infinity", " 0", "0x0"]) {
    file("node-1-" + deadPid + ".run.jsonl");
    const result = cleanupTerminalLogs(directory, value);
    assert.equal(result.retentionDays, 14, value);
    assert.equal(result.deletedFiles, 1, value);
  }
});

test("retention conservatively keeps logs when process ownership cannot be probed", (t) => {
  const { directory, file } = fixture(t);
  const path = file("node-1-" + deadPid + ".run.jsonl");
  t.mock.method(process, "kill", () => { throw Object.assign(new Error("access denied"), { code: "EPERM" }); });
  assert.equal(cleanupTerminalLogs(directory).deletedFiles, 0);
  assert.ok(existsSync(path));
});

test("retention reports a deletion failure without throwing or deleting other files", { skip: process.platform === "win32" }, (t) => {
  const { directory, file } = fixture(t);
  const path = file("node-1-" + deadPid + ".run.jsonl");
  chmodSync(directory, 0o500);
  const result = cleanupTerminalLogs(directory);
  assert.equal(result.failedFiles, 1);
  assert.equal(result.error.code, "EACCES");
  assert.equal(result.deletedFiles, 0);
  assert.ok(existsSync(path));
});
