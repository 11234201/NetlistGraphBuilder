import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  buildStartupUrl,
  createReadyRecord,
  createStartupManifest,
  parseLauncherArgs
} from "../../tools/launcher-options.mjs";

const NETLIST = "module top(input a, output y); BUF u0 (.A(a), .Y(y)); endmodule";
const CELL_CONFIG = JSON.stringify({
  kind: "netlist-cell-config",
  version: 1,
  cells: { BUF: { displayName: "BUF", gateKind: "BUF", pins: { A: "input", Y: "output" } } }
});

test("launcher arguments preserve paths with spaces and normalize targets", () => {
  const options = parseLauncherArgs([
    "--netlist", "inputs/design one.v",
    "--timing", "reports/run one.txt",
    "--cell-config", "config/cells one.json",
    "--module", "top",
    "--focus", "u0",
    "--fanin-depth", "2",
    "--fanout-depth", "0",
    "--port", "4317",
    "--no-open"
  ], { cwd: "C:/eda job", env: {} });

  assert.equal(options.inputs.netlist, resolve("C:/eda job", "inputs/design one.v"));
  assert.equal(options.target.focus, "u0");
  assert.equal(options.target.faninDepth, 2);
  assert.equal(options.target.fanoutDepth, 0);
  assert.equal(options.port, 4317);
  assert.equal(options.openBrowser, false);
});

test("launcher supports the shared session commands", () => {
  const start = parseLauncherArgs(["start", "--port", "0", "--state-file", "run/session.json"], {
    cwd: "C:/eda job", env: {}
  });
  assert.equal(start.command, "start");
  assert.equal(start.port, 0);
  assert.equal(start.stateFile, resolve("C:/eda job", "run/session.json"));
  assert.equal(parseLauncherArgs(["status", "--state-file", "run/session.json"], {
    cwd: "C:/eda job", env: {}
  }).command, "status");
});

test("launcher rejects unknown options and invalid numeric ranges", () => {
  assert.throws(() => parseLauncherArgs(["--remote"]), /Unknown option/);
  assert.equal(parseLauncherArgs(["--port", "0"]).port, 0);
  assert.throws(() => parseLauncherArgs(["--port", "-1"]), /0 to 65535/);
  assert.throws(() => parseLauncherArgs(["--port", "65536"]), /0 to 65535/);
  assert.throws(() => parseLauncherArgs(["--fanin-depth", "100"]), /0 to 99/);
  assert.throws(() => parseLauncherArgs(["--netlist"]), /requires a value/);
});

test("startup manifest validates shared parsers before listening", async () => {
  const options = parseLauncherArgs([
    "--netlist", "design one.v", "--cell-config", "cells one.json",
    "--module", "top", "--focus", "u0", "--no-open"
  ], { cwd: "C:/eda job", env: {} });
  const files = new Map([
    [options.inputs.netlist, NETLIST],
    [options.inputs.cellConfig, CELL_CONFIG]
  ]);
  const manifest = await createStartupManifest(options, async (path) => files.get(path));
  const ready = createReadyRecord(options.port, manifest);

  assert.equal(manifest.inputs.netlist.name, "design one.v");
  assert.equal(manifest.target.focus, "u0");
  assert.equal(ready.host, "127.0.0.1");
  assert.match(ready.url, /\?startup=1$/);
  assert.equal(JSON.stringify(ready).includes(NETLIST), false);
  assert.equal(buildStartupUrl(4173, { version: 1, inputs: {}, target: {} }), "http://127.0.0.1:4173/");
});

test("startup manifest fails before launch for bad config or target", async () => {
  const badConfig = parseLauncherArgs(["--cell-config", "bad.json", "--no-open"], { cwd: "C:/", env: {} });
  await assert.rejects(() => createStartupManifest(badConfig, async () => "{}"), /Invalid --cell-config/);

  const badTarget = parseLauncherArgs(["--netlist", "design.v", "--module", "missing", "--no-open"], { cwd: "C:/", env: {} });
  await assert.rejects(() => createStartupManifest(badTarget, async () => NETLIST), /Module not found/);
});
