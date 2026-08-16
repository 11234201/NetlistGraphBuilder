import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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
  await verifySessionLifecycle(process.execPath, ["tools/serve.mjs"], "node");
  await verifySessionLifecycle("python", ["tools/serve.py"], "python");
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
  const args = [...prefix,
    "--netlist", netlistPath, "--cell-config", configPath,
    "--module", "top", "--focus", "u0",
    "--fanin-depth", "2", "--fanout-depth", "1",
    "--port", "0", "--no-open"
  ];
  const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  try {
    const ready = await waitForReady(child, label);
    assert.equal(ready.event, "ready");
    assert.equal(ready.host, "127.0.0.1");
    assert.ok(Number.isInteger(ready.port) && ready.port > 0, `${label} must report the selected port`);
    assert.equal(ready.startup.netlist, "design one.v");
    assert.equal(ready.startup.focus, "u0");
    assert.equal(JSON.stringify(ready).includes("module top"), false);
    const response = await fetch(`http://127.0.0.1:${ready.port}/__ngb_startup__.json`);
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

async function verifySessionLifecycle(command, prefix, label) {
  const statePath = join(scratch, `${label}-session.json`);
  const child = spawn(command, [...prefix, "start", "--port", "0", "--state-file", statePath, "--no-open"], {
    cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    const ready = await waitForReady(child, `${label} session`);
    assert.ok(ready.port > 0);
    const status = await runLauncherCommand(command, prefix, ["status", "--state-file", statePath]);
    assert.match(status.stdout, /status=running/);
    const stop = await runLauncherCommand(command, prefix, ["stop", "--state-file", statePath]);
    assert.match(stop.stdout, /status=stopped/);
    await waitForExit(child);
    assert.equal(await pathExists(statePath), false);
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await waitForExit(child);
    }
    await rm(statePath, { force: true });
  }
}

function runLauncherCommand(command, prefix, args) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, [...prefix, ...args], {
      cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", rejectCommand);
    child.once("exit", (code, signal) => {
      if (code !== 0) rejectCommand(new Error(`launcher command exited ${code || signal}: ${stderr}`));
      else resolveCommand({ stdout, stderr });
    });
  });
}

function waitForExit(child) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolveExit) => child.once("exit", resolveExit));
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
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
