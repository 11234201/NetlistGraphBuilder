import test from "node:test";
import assert from "node:assert/strict";
import { paintSchematicViewport, schematicViewportRect, setVectorGesturePreview } from "../../src/ui/schematic_viewport.js";

test("overview compositing preserves the viewBox origin, hit coordinates and readable zoom", () => {
  const flags = new Set();
  const host = { clientWidth: 800, clientHeight: 600, getBoundingClientRect: () => ({ width: 800, height: 600 }) };
  const svg = {
    dataset: { sceneNodes: "4096" }, parentElement: host, viewBox: { baseVal: { x: 0, y: 0, width: 160000, height: 800 } },
    classList: { remove() {}, toggle(name, active) { if (active) flags.add(name); else flags.delete(name); } },
    style: { removeProperty(key) { delete this[key]; } }, closest: () => null,
    hasAttribute: (key) => flags.has(key), setAttribute: (key) => flags.add(key), removeAttribute: (key) => flags.delete(key),
    getBoundingClientRect: () => ({ width: 1600, height: 1200 })
  };
  const content = { ownerSVGElement: svg, setAttribute(key, value) { this[key] = value; } };
  paintSchematicViewport(content, { x: 10, y: 20, scale: 2 });
  assert.ok(flags.has("data-composited-viewport"));
  assert.equal(svg.style.transform, "matrix(2,0,0,2,0.05,-297.9)");
  assert.deepEqual(schematicViewportRect(svg), host.getBoundingClientRect());
  setVectorGesturePreview({ querySelectorAll: () => [svg] }, "is-vector-panning", true);
  assert.equal(flags.has("is-vector-panning"), false);
  paintSchematicViewport(content, { x: 10, y: 20, scale: 40 });
  assert.equal(flags.has("data-composited-viewport"), false);
  assert.equal(svg.style.transform, undefined);
  assert.match(content.transform, /scale\(40\)/);
});

test("only the active netlist provider opts into composited overview painting", async () => {
  const { createProgressiveSchematicRenderPlan } = await import("../../src/render/svgRenderer.js");
  const graph = { nodes: Array(4096), edges: [] };
  const options = { createNodePrimitive() {} };
  for (const layoutProvider of [undefined, "simple-layered", "elk-layered"]) {
    assert.doesNotMatch(createProgressiveSchematicRenderPlan({ ...graph, layoutProvider }, options).openSvg, /data-scene-nodes/);
  }
  assert.match(createProgressiveSchematicRenderPlan({ ...graph, layoutProvider: "native-layered" }, options).openSvg, /data-scene-nodes="4096"/);
});
