import { createProgressiveSvgSceneRenderPlan } from "./svg_scene_renderer.js";

const DEFAULT_THRESHOLD = 400;
const DEFAULT_BATCH_SIZE = 120;
const TARGET_SLICE_MS = 8;
const MAX_BATCH_SIZE = 1024;
const VISIBLE_BATCH_INTERVAL_MS = 200;
const MAX_BUFFERED_ITEMS = MAX_BATCH_SIZE * 4;
const activeRenderIds = new WeakMap();

export function cancelSchematicRender(mount) {
  activeRenderIds.delete(mount);
}

export function renderSvgSceneIntoMount(mount, scene, options = {}) {
  const renderId = Symbol("schematic-render");
  if (options.isCurrent?.() === false) {
    return Promise.resolve({ progressive: false, cancelled: true });
  }
  activeRenderIds.set(mount, renderId);
  const isCurrent = () => activeRenderIds.get(mount) === renderId && options.isCurrent?.() !== false;
  const release = () => { if (activeRenderIds.get(mount) === renderId) activeRenderIds.delete(mount); };
  let plan;
  try {
    plan = createProgressiveSvgSceneRenderPlan(scene);
  } catch (error) {
    release();
    throw error;
  }
  const total = plan.edgeCount + plan.nodeCount;
  const threshold = normalizePositiveInteger(options.threshold, DEFAULT_THRESHOLD);
  if (total < threshold) {
    const html = `${plan.openSvg}${plan.renderEdges(0, plan.edgeCount).join("")}${plan.betweenGroups}${plan.renderNodes(0, plan.nodeCount).join("")}${plan.closeSvg}`;
    if (!isCurrent()) {
      release();
      return Promise.resolve({ progressive: false, cancelled: true });
    }
    mount.innerHTML = html;
    options.onProgress?.({ phase: "complete", rendered: total, total });
    return Promise.resolve().then(() => {
      const cancelled = !isCurrent();
      release();
      return cancelled ? { progressive: false, cancelled } : { progressive: false };
    });
  }
  mount.innerHTML = `${plan.openSvg}${plan.betweenGroups}${plan.closeSvg}`;
  const edgeGroup = mount.querySelector(".edges");
  const nodeGroup = mount.querySelector(".nodes");
  if (!edgeGroup || !nodeGroup) {
    release();
    return Promise.reject(new Error("SVG render mount did not create edge and node groups"));
  }
  let batchSize = normalizePositiveInteger(options.batchSize, DEFAULT_BATCH_SIZE);
  const adaptive = options.batchSize === undefined;
  const visibleStride = Math.max(DEFAULT_BATCH_SIZE, Math.min(MAX_BATCH_SIZE * 2, Math.ceil(total / 16)));
  const edgeWriter = createBatchWriter(edgeGroup, adaptive);
  const nodeWriter = createBatchWriter(nodeGroup, adaptive);
  options.onProgress?.({ phase: "render", rendered: 0, total });
  return new Promise((resolve, reject) => {
    let edgeIndex = 0;
    let nodeIndex = 0;
    let nextCommitTime = 0;
    let lastVisibleCount = 0;
    const renderBatch = () => {
      try {
        if (!isCurrent()) {
          release();
          resolve({ progressive: true, cancelled: true });
          return;
        }
        const started = performance.now();
        let remaining = batchSize;
        if (edgeIndex < plan.edgeCount) {
          const end = Math.min(plan.edgeCount, edgeIndex + remaining);
          edgeWriter.write(plan.renderEdges(edgeIndex, end).join(""));
          remaining -= end - edgeIndex;
          edgeIndex = end;
        }
        if (remaining > 0 && nodeIndex < plan.nodeCount) {
          const end = Math.min(plan.nodeCount, nodeIndex + remaining);
          nodeWriter.write(plan.renderNodes(nodeIndex, end).join(""));
          nodeIndex = end;
        }
        if (!isCurrent()) {
          release();
          resolve({ progressive: true, cancelled: true });
          return;
        }
        const rendered = edgeIndex + nodeIndex;
        const pendingCount = rendered - lastVisibleCount;
        if (!adaptive || !lastVisibleCount || rendered === total || pendingCount >= MAX_BUFFERED_ITEMS ||
            (started >= nextCommitTime && pendingCount >= visibleStride)) {
          edgeWriter.commit();
          nodeWriter.commit();
          options.onProgress?.({ phase: "render", rendered, total });
          nextCommitTime = performance.now() + VISIBLE_BATCH_INTERVAL_MS;
          lastVisibleCount = rendered;
        }
        if (rendered < total) {
          // Cap both scripting time and the number of new SVG items. Avoid a
          // paint after every tiny slice when materializing tens of thousands.
          if (adaptive) {
            const duration = Math.max(1, performance.now() - started);
            batchSize = Math.max(32, Math.min(MAX_BATCH_SIZE, Math.round(batchSize * Math.min(2, TARGET_SLICE_MS / duration))));
          }
          // Decode the next slice as a separate task. Only a visible commit
          // dirties the existing SVG, so paint can reuse the previous frame.
          if (edgeWriter.buffered) setTimeout(renderBatch, 0);
          else scheduleFrame(renderBatch);
        } else {
          const cancelled = !isCurrent();
          release();
          resolve({ progressive: true, cancelled });
        }
      } catch (error) {
        release();
        reject(error);
      }
    };
    scheduleFrame(renderBatch);
  });
}

function createBatchWriter(group, buffer) {
  const document = group.ownerDocument;
  if (!buffer || !document?.createRange) {
    return { buffered: false, write: (html) => group.insertAdjacentHTML("beforeend", html), commit() {} };
  }
  const range = document.createRange();
  range.selectNodeContents(group);
  const pending = document.createDocumentFragment();
  return {
    buffered: true,
    write(html) { pending.append(range.createContextualFragment(html)); },
    commit() { if (pending.firstChild) group.append(pending); }
  };
}

function scheduleFrame(callback) {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(callback);
  else setTimeout(callback, 0);
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.max(1, Math.floor(number)) : fallback;
}
