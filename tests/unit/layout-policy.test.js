import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_LAYOUT_POLICY,
  LAYOUT_SPACING_STEP,
  LAYOUT_SPACING_LIMITS,
  normalizeLayoutPolicy,
  snapLayoutSpacingValue
} from "../../src/layout/layoutPolicy.js";
import {
  DEFAULT_TOP_WIRE_LANE_PITCH,
  DEFAULT_WIRE_LANE_PITCH
} from "../../src/layout/simpleLayered.js";

test("default routing channels use 24-pixel lane spacing", () => {
  assert.equal(DEFAULT_LAYOUT_POLICY.spacing.wireLanePitch, 24);
  assert.equal(DEFAULT_LAYOUT_POLICY.spacing.fanoutX, 292);
  assert.equal(DEFAULT_LAYOUT_POLICY.spacing.focusedFanoutX, 544);
  assert.equal(DEFAULT_WIRE_LANE_PITCH, 24);
  assert.equal(DEFAULT_TOP_WIRE_LANE_PITCH, 24);
});

test("direct spacing values snap to the nearest configured step", () => {
  assert.equal(LAYOUT_SPACING_STEP, 4);
  assert.equal(snapLayoutSpacingValue(29, LAYOUT_SPACING_LIMITS.wireLanePitch), 28);
  assert.equal(snapLayoutSpacingValue(30, LAYOUT_SPACING_LIMITS.wireLanePitch), 32);
  assert.equal(snapLayoutSpacingValue(2, LAYOUT_SPACING_LIMITS.wireLanePitch), 4);
  assert.equal(snapLayoutSpacingValue(319, LAYOUT_SPACING_LIMITS.cellSpacing), 320);
  assert.equal(snapLayoutSpacingValue("invalid", LAYOUT_SPACING_LIMITS.cellSpacing, 4, 24), 24);
});

test("layout policy normalizes numeric values without mutating its input", () => {
  const input = {
    spacing: {
      wireLanePitch: "32",
      cellSpacing: 999,
      cellPinPitch: 500,
      branchBandSize: 999,
      branchBandGap: -1,
      branchCenterGap: 9999,
      margin: "invalid",
      topPadding: 9999
    },
    features: { alignDrivenLinks: "false" }
  };
  const policy = normalizeLayoutPolicy(input);

  assert.equal(policy.spacing.wireLanePitch, 32);
  assert.equal(policy.spacing.cellSpacing, LAYOUT_SPACING_LIMITS.cellSpacing[1]);
  assert.equal(policy.spacing.cellPinPitch, LAYOUT_SPACING_LIMITS.cellPinPitch[1]);
  assert.equal(policy.spacing.branchBandSize, LAYOUT_SPACING_LIMITS.branchBandSize[1]);
  assert.equal(policy.spacing.branchBandGap, LAYOUT_SPACING_LIMITS.branchBandGap[0]);
  assert.equal(policy.spacing.branchCenterGap, LAYOUT_SPACING_LIMITS.branchCenterGap[1]);
  assert.equal(policy.spacing.margin, DEFAULT_LAYOUT_POLICY.spacing.margin);
  assert.equal(policy.spacing.topPadding, LAYOUT_SPACING_LIMITS.topPadding[1]);
  assert.equal(policy.features.alignDrivenLinks, false);
  assert.deepEqual(input.spacing, {
    wireLanePitch: "32",
    cellSpacing: 999,
    cellPinPitch: 500,
    branchBandSize: 999,
    branchBandGap: -1,
    branchCenterGap: 9999,
    margin: "invalid",
    topPadding: 9999
  });
});

test("legacy layout options pass through the same policy limits", () => {
  const policy = normalizeLayoutPolicy({}, {
    wireLanePitch: 1,
    cellSpacing: 1,
    compactX: 5000,
    branchAwareLanes: false
  });

  assert.equal(policy.spacing.wireLanePitch, LAYOUT_SPACING_LIMITS.wireLanePitch[0]);
  assert.equal(policy.spacing.cellSpacing, LAYOUT_SPACING_LIMITS.cellSpacing[0]);
  assert.equal(policy.spacing.compactX, LAYOUT_SPACING_LIMITS.compactX[1]);
  assert.equal(policy.features.branchAwareLanes, false);
});
