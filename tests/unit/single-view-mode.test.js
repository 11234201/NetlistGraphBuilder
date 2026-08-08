import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSingleViewMode } from "../../src/app/singleViewMode.js";

test("legacy one-way views migrate to Focused", () => {
  assert.equal(normalizeSingleViewMode("fanin"), "focused");
  assert.equal(normalizeSingleViewMode("fanout"), "focused");
  assert.equal(normalizeSingleViewMode("focused"), "focused");
  assert.equal(normalizeSingleViewMode("unexpected"), "whole");
});
