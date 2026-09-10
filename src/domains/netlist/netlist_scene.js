import {
  createProgressiveSchematicRenderPlan as createGenericProgressivePlan,
  createSchematicRenderPlan as createGenericRenderPlan,
  createSchematicScene
} from "../../render/svgRenderer.js";
import { renderSvgScene } from "../../render/svg_scene_renderer.js";
import { renderSvgSceneIntoMount } from "../../render/progressiveSvgRenderer.js";
import { createNetlistNodePrimitive } from "./netlist_scene_presentation.js";

export function createNetlistScene(graph, options = {}) {
  return createSchematicScene(graph, { ...options, createNodePrimitive: createNetlistNodePrimitive });
}

export function renderSchematicSvg(graph, options = {}) {
  return renderSvgScene(createNetlistScene(graph, options));
}

export function createSchematicRenderPlan(graph, options = {}) {
  return createGenericRenderPlan(graph, { ...options, createNodePrimitive: createNetlistNodePrimitive });
}

export function createProgressiveSchematicRenderPlan(graph, options = {}) {
  return createGenericProgressivePlan(graph, { ...options, createNodePrimitive: createNetlistNodePrimitive });
}

export function renderSchematicIntoMount(mount, graph, options = {}) {
  return renderSvgSceneIntoMount(mount, createNetlistScene(graph, options), options);
}
