import assert from "node:assert/strict";
import test from "node:test";
import {
  clientPointToViewBox,
  formatViewportTransform,
  getAdaptiveMaxScale,
  getFocusedObjectTransform,
  getPannedTransform,
  getReadableObjectScale,
  getSteppedZoomedTransform,
  getZoomedTransform,
  getZoomStep
} from "../../src/ui/viewport.js";

test("ordinary schematics retain the existing zoom behavior", () => {
  assert.equal(getAdaptiveMaxScale(1000, 1000), 32);
  assert.equal(getZoomStep(1000, 1000), 1.12);
});

test("focused object transform centers a cell at the requested reading width", () => {
  const options = {
    viewBox: { x: 0, y: 0, width: 1000, height: 500 },
    viewportWidth: 500,
    bounds: { x: 100, y: 50, width: 100, height: 40 },
    targetPixels: 220,
    minimumScale: 0.25,
    maximumScale: 10
  };
  const first = getFocusedObjectTransform(options);
  const second = getFocusedObjectTransform({ ...options, currentTransform: first });
  assert.deepEqual(first, { x: -160, y: -58, scale: 4.4 });
  assert.deepEqual(second, first);
  assert.ok(Math.abs((options.bounds.width * first.scale) / (options.viewBox.width / options.viewportWidth) - 220) < 1e-9);
  assert.equal(getFocusedObjectTransform({ ...options, maximumScale: 3 }).scale, 3);
});

test("very wide schematics receive a usable adaptive zoom range", () => {
  const maxScale = getAdaptiveMaxScale(200000, 1000);
  const focusScale = getReadableObjectScale({
    viewBoxWidth: 200000,
    viewportWidth: 1000,
    objectWidth: 120
  });

  assert.equal(maxScale, 6400);
  assert.ok(focusScale >= 230);
  assert.ok(focusScale <= maxScale);
  assert.equal(getZoomStep(200000, 1000), 1.5);
});

test("adaptive zoom values remain bounded for malformed or extreme sizes", () => {
  assert.equal(getAdaptiveMaxScale(Infinity, 0), 32);
  assert.equal(getAdaptiveMaxScale(1e12, 1), 32e12);
});

test("focused object sizing uses the limiting viewport axis", () => {
  const options = {
    viewBox: { x: 0, y: 0, width: 1000, height: 4000 },
    viewportWidth: 1000,
    viewportHeight: 500,
    bounds: { x: 100, y: 100, width: 100, height: 60 },
    targetPixels: 320
  };
  const focused = getFocusedObjectTransform(options);

  assert.equal(focused.scale, 25.6);
  assert.equal((options.bounds.width * focused.scale) / 8, 320);
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

test("coalesced wheel steps preserve zoom distance with one final transform", () => {
  const start = { x: 10, y: 20, scale: 1 };
  const point = { x: 100, y: 80 };
  let sequential = start;
  for (let index = 0; index < 3; index += 1) {
    sequential = getZoomedTransform(sequential, point, -1, 1000, 1000);
  }

  assert.deepEqual(
    getSteppedZoomedTransform(start, point, -3, 1000, 1000),
    sequential
  );
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
