import { createProgressiveSvgSceneRenderPlan } from "./svg_scene_renderer.js";

const DEFAULT_THRESHOLD = 400;
const DEFAULT_BATCH_SIZE = 120;
const activeRenderIds = new WeakMap();

export function cancelSchematicRender(mount) {
  activeRenderIds.delete(mount);
}

export function renderSvgSceneIntoMount(mount, scene, options = {}) {
  const renderId = Symbol("schematic-render");
  activeRenderIds.set(mount, renderId);
  let plan;
  try {
    plan = createProgressiveSvgSceneRenderPlan(scene);
  } catch (error) {
    activeRenderIds.delete(mount);
    throw error;
  }
  const total = plan.edgeCount + plan.nodeCount;
  const threshold = normalizePositiveInteger(options.threshold, DEFAULT_THRESHOLD);
  if (total < threshold) {
    mount.innerHTML = `${plan.openSvg}${plan.renderEdges(0, plan.edgeCount).join("")}${plan.betweenGroups}${plan.renderNodes(0, plan.nodeCount).join("")}${plan.closeSvg}`;
    options.onProgress?.({ phase: "complete", rendered: total, total });
    return Promise.resolve().then(() => {
      if (activeRenderIds.get(mount) !== renderId) return { progressive: false, cancelled: true };
      activeRenderIds.delete(mount);
      return { progressive: false };
    });
  }
  mount.innerHTML = `${plan.openSvg}${plan.betweenGroups}${plan.closeSvg}`;
  const edgeGroup = mount.querySelector(".edges");
  const nodeGroup = mount.querySelector(".nodes");
  if (!edgeGroup || !nodeGroup) {
    activeRenderIds.delete(mount);
    return Promise.reject(new Error("SVG render mount did not create edge and node groups"));
  }
  const batchSize = normalizePositiveInteger(options.batchSize, DEFAULT_BATCH_SIZE);
  options.onProgress?.({ phase: "render", rendered: 0, total });
  return new Promise((resolve, reject) => {
    let edgeIndex = 0;
    let nodeIndex = 0;
    const renderBatch = () => {
      try {
        if (activeRenderIds.get(mount) !== renderId || options.isCurrent?.() === false) {
          if (activeRenderIds.get(mount) === renderId) activeRenderIds.delete(mount);
          resolve({ progressive: true, cancelled: true });
          return;
        }
        let remaining = batchSize;
        if (edgeIndex < plan.edgeCount) {
          const end = Math.min(plan.edgeCount, edgeIndex + remaining);
          edgeGroup.insertAdjacentHTML("beforeend", plan.renderEdges(edgeIndex, end).join(""));
          remaining -= end - edgeIndex;
          edgeIndex = end;
        }
        if (remaining > 0 && nodeIndex < plan.nodeCount) {
          const end = Math.min(plan.nodeCount, nodeIndex + remaining);
          nodeGroup.insertAdjacentHTML("beforeend", plan.renderNodes(nodeIndex, end).join(""));
          nodeIndex = end;
        }
        const rendered = edgeIndex + nodeIndex;
        options.onProgress?.({ phase: "render", rendered, total });
        if (rendered < total) scheduleFrame(renderBatch);
        else {
          activeRenderIds.delete(mount);
          resolve({ progressive: true, cancelled: false });
        }
      } catch (error) {
        activeRenderIds.delete(mount);
        reject(error);
      }
    };
    scheduleFrame(renderBatch);
  });
}

function scheduleFrame(callback) {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(callback);
  else setTimeout(callback, 0);
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.max(1, Math.floor(number)) : fallback;
}
