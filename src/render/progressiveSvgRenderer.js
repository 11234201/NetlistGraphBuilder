import {
  createProgressiveSchematicRenderPlan,
  renderSchematicSvg
} from "./svgRenderer.js";

const DEFAULT_THRESHOLD = 400;
const DEFAULT_BATCH_SIZE = 120;
const activeRenderIds = new WeakMap();

export function renderSchematicIntoMount(mount, graph, options = {}) {
  const threshold = options.threshold || DEFAULT_THRESHOLD;
  if (graph.nodes.length < threshold) {
    mount.innerHTML = renderSchematicSvg(graph);
    options.onProgress?.({ phase: "complete", rendered: graph.nodes.length, total: graph.nodes.length });
    return Promise.resolve({ progressive: false });
  }
  const renderId = Symbol("progressive-render");
  activeRenderIds.set(mount, renderId);
  const plan = createProgressiveSchematicRenderPlan(graph);
  mount.innerHTML = `${plan.openSvg}${plan.betweenGroups}${plan.closeSvg}`;
  const edgeGroup = mount.querySelector(".edges");
  const nodeGroup = mount.querySelector(".nodes");
  const total = plan.edgeCount + plan.nodeCount;
  const batchSize = Math.max(1, Math.floor(Number(options.batchSize) || DEFAULT_BATCH_SIZE));
  options.onProgress?.({ phase: "render", rendered: 0, total });
  return new Promise((resolve) => {
    let edgeIndex = 0;
    let nodeIndex = 0;
    const renderBatch = () => {
      if (activeRenderIds.get(mount) !== renderId) {
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
      else resolve({ progressive: true, cancelled: false });
    };
    scheduleFrame(renderBatch);
  });
}

function scheduleFrame(callback) {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(callback);
  else setTimeout(callback, 0);
}
