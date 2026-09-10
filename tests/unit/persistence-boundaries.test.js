import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("storage and startup decoding stay behind persistence boundaries", async () => {
  const [cellConfigSource, storageSource, startupControllerSource] = await Promise.all([
    readSource("../../src/infer/cellConfig.js"),
    readSource("../../src/persistence/cell_config_storage.js"),
    readSource("../../src/app/startupController.js")
  ]);

  assert.doesNotMatch(cellConfigSource, /localStorage|\.getItem\(|\.setItem\(/);
  assert.match(storageSource, /localStorage/);
  assert.match(startupControllerSource, /persistence\/startup_codec\.js/);
  assert.doesNotMatch(startupControllerSource, /function normalizeInput|function normalizeDepth/);
});
