import assert from "node:assert/strict";
import test from "node:test";
import {
  executeStartupManifest,
  fetchStartupManifest,
  normalizeStartupManifest
} from "../../src/app/startupController.js";

const MANIFEST = {
  version: 1,
  inputs: {
    cellConfig: { name: "cells.json", text: "config" },
    netlist: { name: "design.v", text: "netlist" },
    timing: { name: "timing.txt", text: "timing" }
  },
  target: { module: "top", focus: "u0", faninDepth: 2, fanoutDepth: 1 }
};

test("startup controller executes inputs and target in dependency order", async () => {
  const calls = [];
  const handlers = {
    configureTarget: async () => calls.push("target"),
    loadCellConfig: async () => calls.push("config"),
    loadNetlist: async () => calls.push("netlist"),
    ensureDesign: async () => calls.push("design"),
    loadTiming: async () => calls.push("timing"),
    selectModule: async () => calls.push("module"),
    focusCell: async () => calls.push("focus"),
    ready: async () => calls.push("ready")
  };

  await executeStartupManifest(MANIFEST, handlers);
  assert.deepEqual(calls, ["target", "config", "netlist", "design", "timing", "module", "focus", "ready"]);
});

test("startup manifest normalization rejects malformed data without mutation", () => {
  const normalized = normalizeStartupManifest(MANIFEST);
  normalized.target.module = "changed";
  assert.equal(MANIFEST.target.module, "top");
  assert.throws(() => normalizeStartupManifest({ version: 2 }), /Unsupported/);
  assert.throws(() => normalizeStartupManifest({ version: 1, target: { faninDepth: -1 } }), /0 to 99/);
  assert.throws(() => normalizeStartupManifest({ version: 1, inputs: { netlist: {} } }), /must contain text/);
});

test("startup manifest fetch is opt-in and uses the same-origin endpoint", async () => {
  let requested = null;
  assert.equal(await fetchStartupManifest("", async () => { throw new Error("unused"); }), null);
  const manifest = await fetchStartupManifest("?startup=1", async (url, options) => {
    requested = { url, options };
    return { ok: true, json: async () => MANIFEST };
  });
  assert.equal(requested.url, "./__ngb_startup__.json");
  assert.equal(requested.options.cache, "no-store");
  assert.equal(manifest.target.focus, "u0");
});
