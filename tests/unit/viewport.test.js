import assert from "node:assert/strict";
import test from "node:test";
import {
  clientPointToViewBox,
  formatViewportTransform,
  getAdaptiveMaxScale,
  getPannedTransform,
  getReadableObjectScale,
  getZoomedTransform,
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

test("zoom keeps the pointer's graph position stationary", () => {
  const next = getZoomedTransform(
    { x: 10, y: 20, scale: 1 },
    { x: 100, y: 80 },
    -1,
    1000,
    1000
  );
  assert.ok(Math.abs(next.x + 0.8) < 1e-9);
  assert.ok(Math.abs(next.y - 12.8) < 1e-9);
  assert.equal(next.scale, 1.12);
});

test("pan and client conversion use viewBox-to-viewport scale", () => {
  assert.deepEqual(
    getPannedTransform(
      { x: 10, y: 20, scale: 2 },
      { x: 100, y: 200 },
      { x: 150, y: 220 },
      { width: 1000, height: 500 },
      { width: 500, height: 250 }
    ),
    { x: 110, y: 60, scale: 2 }
  );
  assert.deepEqual(
    clientPointToViewBox(
      { x: 350, y: 225 },
      { left: 100, top: 100, width: 500, height: 250 },
      { x: 20, y: 30, width: 1000, height: 500 }
    ),
    { x: 520, y: 280 }
  );
  assert.equal(
    formatViewportTransform({ x: 1.23456, y: 7.89123, scale: 1.23456 }),
    "translate(1.235 7.891) scale(1.235)"
  );
});

test("malformed pointer snapshots cannot poison pan and zoom transforms", () => {
  const panned = getPannedTransform(
    { x: 10, y: 20, scale: 1 },
    { x: 100, y: 200 },
    { clientX: 120, clientY: 220 },
    { width: 1000, height: 500 },
    { width: 500, height: 250 }
  );
  const zoomed = getZoomedTransform(
    { x: Number.NaN, y: Number.NaN, scale: 1 },
    { x: 100, y: 80 },
    -1,
    1000,
    1000
  );

  assert.deepEqual(panned, { x: 10, y: 20, scale: 1 });
  assert.ok(Number.isFinite(zoomed.x));
  assert.ok(Number.isFinite(zoomed.y));
  assert.equal(zoomed.scale, 1.12);
});
