import test from "node:test";
import assert from "node:assert/strict";
import { readSpacingInput, syncSpacingControls } from "../../src/ui/spacingControls.js";

test("spacing commits round valid values and retain previous values for empty input", () => {
  for (const value of ["", " ", "invalid"]) {
    assert.equal(readSpacingInput(value, "wireLanePitch", 24), 24);
  }
  assert.equal(readSpacingInput("29", "wireLanePitch", 24), 28);
  assert.equal(readSpacingInput("30", "wireLanePitch", 24), 32);
  assert.equal(readSpacingInput("900", "cellSpacing", 8), 320);
});

test("restoring spacing synchronizes number, range and output without rewriting policy", () => {
  const elements = {};
  for (const prefix of ["wire", "cell"]) {
    for (const suffix of ["Input", "NumberInput", "Value"]) elements[`${prefix}Spacing${suffix}`] = {};
  }
  const spacing = { wireLanePitch: 18, cellSpacing: 32 };
  syncSpacingControls(elements, spacing);
  assert.equal(elements.wireSpacingNumberInput.value, "18");
  assert.equal(elements.cellSpacingValue.value, "32");
  assert.equal(spacing.wireLanePitch, 18);
});
