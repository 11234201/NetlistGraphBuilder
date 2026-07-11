import { createSchematicRenderPlan, renderSchematicSvg } from "./svgRenderer.js";

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
  const plan = createSchematicRenderPlan(graph);
  mount.innerHTML = `${plan.openSvg}${plan.betweenGroups}${plan.closeSvg}`;
  const edgeGroup = mount.querySelector(".edges");
  const nodeGroup = mount.querySelector(".nodes");
  const items = [
    ...plan.edges.map((html) => ({ group: edgeGroup, html })),
    ...plan.nodes.map((html) => ({ group: nodeGroup, html }))
  ];
  const batchSize = options.batchSize || DEFAULT_BATCH_SIZE;
  options.onProgress?.({ phase: "render", rendered: 0, total: items.length });
  return new Promise((resolve) => {
    let index = 0;
    const renderBatch = () => {
      if (activeRenderIds.get(mount) !== renderId) {
        resolve({ progressive: true, cancelled: true });
        return;
      }
      const batch = items.slice(index, index + batchSize);
      const byGroup = new Map();
      for (const item of batch) byGroup.set(item.group, (byGroup.get(item.group) || "") + item.html);
      for (const [group, html] of byGroup) group.insertAdjacentHTML("beforeend", html);
      index += batch.length;
      options.onProgress?.({ phase: "render", rendered: index, total: items.length });
      if (index < items.length) scheduleFrame(renderBatch);
      else resolve({ progressive: true, cancelled: false });
    };
    scheduleFrame(renderBatch);
  });
}

function scheduleFrame(callback) {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(callback);
  else setTimeout(callback, 0);
}
