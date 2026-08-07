import assert from "node:assert/strict";
import test from "node:test";
import {
  closeAllDisclosures,
  closeDisclosuresOutside,
  closeOtherDisclosures
} from "../../src/ui/disclosure.js";

function disclosure(open, containedTarget = null) {
  return { open, contains: (target) => target === containedTarget };
}

test("outside pointer closes only open disclosures not containing the target", () => {
  const target = {};
  const inside = disclosure(true, target);
  const outside = disclosure(true);
  closeDisclosuresOutside([inside, outside], target);
  assert.equal(inside.open, true);
  assert.equal(outside.open, false);
});

test("opening one disclosure closes siblings and Escape closes all", () => {
  const left = disclosure(true);
  const right = disclosure(true);
  closeOtherDisclosures([left, right], right);
  assert.equal(left.open, false);
  assert.equal(right.open, true);
  closeAllDisclosures([left, right]);
  assert.equal(right.open, false);
});
