import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const scratch = await mkdtemp(join(tmpdir(), "ngb launcher "));
const inputs = join(scratch, "inputs with spaces");
await mkdir(inputs);
const netlistPath = join(inputs, "design one.v");
const configPath = join(inputs, "cells one.json");
const badConfigPath = join(inputs, "bad cells.json");
await writeFile(netlistPath, "module top(input a, output y); BUF u0 (.A(a), .Y(y)); endmodule\n", "utf8");
await writeFile(configPath, JSON.stringify({
  kind: "netlist-cell-config",
  version: 1,
  cells: { BUF: { displayName: "BUF", gateKind: "BUF", pins: { A: "input", Y: "output" } } }
}), "utf8");
await writeFile(badConfigPath, "{}", "utf8");

try {
  await verifyLauncher(process.execPath, ["tools/serve.mjs"], "node");
  await verifyLauncher("python", ["tools/serve.py"], "python");
  await verifyInvalidConfig(process.execPath, ["tools/serve.mjs"], "node");
  await verifyInvalidConfig("python", ["tools/serve.py"], "python");
  console.log("Launcher end-to-end checks passed for Node and Python.");
} finally {
  await rm(scratch, { recursive: true, force: true });
}

async function verifyInvalidConfig(command, prefix, label) {
  const child = spawn(command, [...prefix, "--cell-config", badConfigPath, "--no-open"], {
    cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const code = await new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", resolveExit);
  });
  assert.equal(code, 2, `${label} invalid config exit code`);
  assert.match(stderr, /cell.config|schema|kind/i);
}

async function verifyLauncher(command, prefix, label) {
  const port = await findFreePort();
  const args = [...prefix,
    "--netlist", netlistPath, "--cell-config", configPath,
    "--module", "top", "--focus", "u0",
    "--fanin-depth", "2", "--fanout-depth", "1",
    "--port", String(port), "--no-open"
  ];
  const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  try {
    const ready = await waitForReady(child, label);
    assert.equal(ready.event, "ready");
    assert.equal(ready.host, "127.0.0.1");
    assert.equal(ready.port, port);
    assert.equal(ready.startup.netlist, "design one.v");
    assert.equal(ready.startup.focus, "u0");
    assert.equal(JSON.stringify(ready).includes("module top"), false);
    const response = await fetch(`http://127.0.0.1:${port}/__ngb_startup__.json`);
    assert.equal(response.status, 200);
    const manifest = await response.json();
    assert.equal(manifest.inputs.netlist.text.includes("BUF u0"), true);
    assert.deepEqual(manifest.target, { module: "top", focus: "u0", faninDepth: 2, fanoutDepth: 1 });
  } finally {
    if (child.exitCode === null) {
      const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
      child.kill();
      await exited;
    }
  }
}

function waitForReady(child, label) {
  return new Promise((resolveReady, rejectReady) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => rejectReady(new Error(`${label} launcher ready timeout: ${stderr}`)), 8000);
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectReady(error);
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const line = stdout.split(/\r?\n/).find((item) => item.trim().startsWith("{"));
      if (!line) return;
      clearTimeout(timer);
      try { resolveReady(JSON.parse(line)); } catch (error) { rejectReady(error); }
    });
    child.once("exit", (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timer);
        rejectReady(new Error(`${label} launcher exited ${code}: ${stderr}`));
      }
    });
  });
}

function findFreePort() {
  return new Promise((resolvePort, rejectPort) => {
    const probe = createServer();
    probe.once("error", rejectPort);
    probe.listen(0, "127.0.0.1", () => {
      const port = probe.address().port;
      probe.close((error) => error ? rejectPort(error) : resolvePort(port));
    });
  });
}
