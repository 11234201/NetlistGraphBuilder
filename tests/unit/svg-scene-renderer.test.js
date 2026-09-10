import assert from "node:assert/strict";
import test from "node:test";
import { createSchematicScene, renderSchematicSvg } from "../../src/render/svgRenderer.js";
import { createProgressiveSvgSceneRenderPlan, renderSvgScene } from "../../src/render/svg_scene_renderer.js";

const graph = {
  moduleDisplayName: "scene & module",
  width: 320,
  height: 180,
  nodes: [{ id: "input:a", kind: "input", label: "a", x: 10, y: 20, width: 92, height: 28 }],
  edges: []
};

test("schematic scene is lazy and shares the generic SVG scene renderer", () => {
  const scene = createSchematicScene(graph);
  const plan = createProgressiveSvgSceneRenderPlan(scene);

  assert.equal(scene.nodeCount, 1);
  assert.equal(plan.renderNodes(0, 1).length, 1);
  assert.equal(renderSvgScene(scene), renderSchematicSvg(graph));
  assert.match(plan.openSvg, /aria-label="scene &amp; module schematic"/);
});

test("generic SVG scene renderer rejects graph-shaped input", () => {
  assert.throws(() => renderSvgScene(graph), /Expected an SVG scene/);
});
