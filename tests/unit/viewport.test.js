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

test("ordinary schematics cap zoom at twice the layout scale", () => {
  assert.equal(getAdaptiveMaxScale(1000, 1000), 2);
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

  assert.equal(maxScale, 400);
  assert.ok(focusScale >= 230);
  assert.ok(focusScale <= maxScale);
  assert.equal(getZoomStep(200000, 1000), 1.5);
});

test("adaptive zoom values remain bounded for malformed or extreme sizes", () => {
  assert.equal(getAdaptiveMaxScale(Infinity, 0), 2);
  assert.equal(getAdaptiveMaxScale(1e12, 1), 2e12);
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

  assert.equal(focused.scale, 16);
  assert.equal((options.bounds.width * focused.scale) / 8, 200);
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
    "scale(1.235) translate(1 6.392)"
  );
});

test("viewport transform keeps large-canvas translation operands near graph coordinates", () => {
  const transform = formatViewportTransform({
    x: -18394994.186,
    y: -55530965.356,
    scale: 895.678
  });

  assert.equal(transform, "scale(895.678) translate(-20537.508 -61998.805)");
  assert.doesNotMatch(transform, /18394994|55530965/);
});

test("pan uses the limiting SVG meet scale on very wide schematics", () => {
  const viewBox = { x: 0, y: 0, width: 200000, height: 1000 };
  const viewport = { left: 100, top: 50, width: 1000, height: 500 };
  const panned = getPannedTransform(
    { x: 0, y: 0, scale: 400 },
    { x: 500, y: 250 },
    { x: 550, y: 270 },
    viewBox,
    viewport
  );

  assert.deepEqual(panned, { x: 10000, y: 4000, scale: 400 });
  assert.deepEqual(
    clientPointToViewBox(
      { x: 600, y: 300 },
      viewport,
      viewBox
    ),
    { x: 100000, y: 500 }
  );
});

test("pan follows screen pixels when the SVG viewBox is magnified", () => {
  assert.deepEqual(getPannedTransform(
    { x: 10, y: 20, scale: 1.3 }, { x: 200, y: 300 }, { x: 260, y: 330 },
    { x: 20, y: 30, width: 640, height: 525 }, { width: 1280, height: 1200 }
  ), { x: 40, y: 35, scale: 1.3 });
});

test("magnified SVG client coordinates preserve either letterbox axis and nonzero viewBox origins", () => {
  assert.deepEqual(clientPointToViewBox(
    { x: 420, y: 245 }, { left: 100, top: 50, width: 1280, height: 1200 },
    { x: 20, y: 30, width: 640, height: 525 }
  ), { x: 180, y: 90 });
  assert.deepEqual(clientPointToViewBox(
    { x: 410, y: 420 }, { left: 10, top: 20, width: 1200, height: 1600 },
    { x: -40, y: 90, width: 400, height: 800 }
  ), { x: 60, y: 290 });
});

test("off-center wheel zoom retains its screen anchor in a magnified letterboxed SVG", () => {
  const viewBox = { x: 20, y: 30, width: 640, height: 525 };
  const viewport = { left: 100, top: 50, width: 1280, height: 1200 };
  const client = { x: 420, y: 245 };
  const start = { x: 35, y: -12, scale: 1.3 };
  // xMidYMid meet scales this viewBox by two, leaving 75px above/below it.
  const graphPoint = { x: (180 - start.x) / start.scale, y: (90 - start.y) / start.scale };
  const next = getZoomedTransform(start, clientPointToViewBox(client, viewport, viewBox), -1,
    viewBox.width, viewport.width, 0.25, viewBox.height, viewport.height);
  assert.ok(Math.abs(viewport.left + (next.x + graphPoint.x * next.scale - viewBox.x) * 2 - client.x) < 1e-9);
  assert.ok(Math.abs(viewport.top + 75 + (next.y + graphPoint.y * next.scale - viewBox.y) * 2 - client.y) < 1e-9);
  assert.equal(getAdaptiveMaxScale(viewBox.width, viewport.width, viewBox.height, viewport.height), 2);
  assert.equal(getFocusedObjectTransform({ viewBox, viewportWidth: viewport.width, viewportHeight: viewport.height,
    bounds: { x: 20, y: 30, width: 100, height: 40 }, targetPixels: 320 }).scale, 2);
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
