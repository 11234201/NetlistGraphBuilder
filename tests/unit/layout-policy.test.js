import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_LAYOUT_POLICY,
  LAYOUT_SPACING_LIMITS,
  normalizeLayoutPolicy
} from "../../src/layout/layoutPolicy.js";

test("layout policy normalizes numeric values without mutating its input", () => {
  const input = {
    spacing: { wireLanePitch: "32", cellPinPitch: 500, margin: "invalid" },
    features: { alignDrivenLinks: "false" }
  };
  const policy = normalizeLayoutPolicy(input);

  assert.equal(policy.spacing.wireLanePitch, 32);
  assert.equal(policy.spacing.cellPinPitch, LAYOUT_SPACING_LIMITS.cellPinPitch[1]);
  assert.equal(policy.spacing.margin, DEFAULT_LAYOUT_POLICY.spacing.margin);
  assert.equal(policy.features.alignDrivenLinks, false);
  assert.deepEqual(input.spacing, {
    wireLanePitch: "32",
    cellPinPitch: 500,
    margin: "invalid"
  });
});

test("legacy layout options pass through the same policy limits", () => {
  const policy = normalizeLayoutPolicy({}, {
    wireLanePitch: 1,
    compactX: 5000,
    branchAwareLanes: false
  });

  assert.equal(policy.spacing.wireLanePitch, LAYOUT_SPACING_LIMITS.wireLanePitch[0]);
  assert.equal(policy.spacing.compactX, LAYOUT_SPACING_LIMITS.compactX[1]);
  assert.equal(policy.features.branchAwareLanes, false);
});
