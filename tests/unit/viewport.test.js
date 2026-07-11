import assert from "node:assert/strict";
import test from "node:test";
import {
  getAdaptiveMaxScale,
  getReadableObjectScale,
  getZoomStep
} from "../../src/ui/viewport.js";

test("ordinary schematics retain the existing zoom behavior", () => {
  assert.equal(getAdaptiveMaxScale(1000, 1000), 4);
  assert.equal(getZoomStep(1000, 1000), 1.12);
});

test("very wide schematics receive a usable adaptive zoom range", () => {
  const maxScale = getAdaptiveMaxScale(200000, 1000);
  const focusScale = getReadableObjectScale({
    viewBoxWidth: 200000,
    viewportWidth: 1000,
    objectWidth: 120
  });

  assert.equal(maxScale, 800);
  assert.ok(focusScale >= 230);
  assert.ok(focusScale <= maxScale);
  assert.equal(getZoomStep(200000, 1000), 1.5);
});

test("adaptive zoom values remain bounded for malformed or extreme sizes", () => {
  assert.equal(getAdaptiveMaxScale(Infinity, 0), 4);
  assert.equal(getAdaptiveMaxScale(1e12, 1), 2048);
});
