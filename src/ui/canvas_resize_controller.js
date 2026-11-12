import { createLatestFrameScheduler } from "./frameScheduler.js";
import { formatViewportTransform, getResizedViewportTransform } from "./viewport.js";

export function createCanvasResizeController({
  readViews,
  commit,
  windowTarget = globalThis.window,
  requestFrame,
  cancelFrame,
  ResizeObserverClass = globalThis.ResizeObserver,
  MutationObserverClass = globalThis.MutationObserver,
  settleDelay = 120
}) {
  const cached = new Map();
  const observed = new Map();
  const setTimer = windowTarget?.setTimeout?.bind(windowTarget) || globalThis.setTimeout;
  const clearTimer = windowTarget?.clearTimeout?.bind(windowTarget) || globalThis.clearTimeout;
  let disposed = false;
  let settleTimer = null;
  let previewGesture = false;
  const frame = createLatestFrameScheduler(() => {
    update(true);
    if (!previewGesture) scheduleCommit();
  }, { requestFrame, cancelFrame });
  const sizeObserver = ResizeObserverClass ? new ResizeObserverClass(() => frame.schedule()) : null;

  function scheduleCommit() {
    clearTimer(settleTimer);
    settleTimer = setTimer(() => { settleTimer = null; update(false); }, settleDelay);
  }

  function synchronizeObservers(views) {
    const ids = new Set(views.map((view) => view.id));
    for (const [id, entry] of observed) {
      const current = views.find((view) => view.id === id);
      if (ids.has(id) && current.mount === entry.mount) continue;
      sizeObserver?.unobserve(entry.mount);
      entry.mountObserver?.disconnect();
      entry.contentObserver?.disconnect();
      observed.delete(id);
      cached.delete(id);
    }
    for (const view of views) {
      if (!view.mount || observed.has(view.id)) continue;
      const mountObserver = MutationObserverClass ? new MutationObserverClass(() => capture()) : null;
      mountObserver?.observe(view.mount, { childList: true });
      sizeObserver?.observe(view.mount);
      observed.set(view.id, { mount: view.mount, mountObserver, contentObserver: null, content: null });
    }
  }

  function snapshot(view) {
    const svg = view.mount?.querySelector("svg");
    const content = svg?.querySelector("#schematicContent");
    const bounds = svg?.getBoundingClientRect();
    const raw = svg?.viewBox?.baseVal;
    const viewBox = raw ? { x: raw.x, y: raw.y, width: raw.width, height: raw.height } : null;
    const viewport = view.viewport;
    if (!content || !viewBox || !(bounds.width > 0 && bounds.height > 0) ||
        !(viewBox.width > 0 && viewBox.height > 0) ||
        !viewport || ![viewport.x, viewport.y, viewport.scale].every(Number.isFinite) || viewport.scale <= 0) return null;
    return {
      svg, content, viewBox, mount: view.mount,
      size: { width: bounds.width, height: bounds.height },
      authoritative: { ...viewport }
    };
  }

  function read() {
    const views = readViews() || [];
    synchronizeObservers(views);
    return views;
  }

  function ensureEntry(view, current) {
    const previous = cached.get(view.id);
    const externalViewport = previous && !sameViewport(previous.authoritative, current.authoritative);
    const externalPaint = previous?.pending &&
      current.content.getAttribute("transform") !== formatViewportTransform(previous.display);
    if (!previous || previous.svg !== current.svg || previous.content !== current.content ||
        !sameViewBox(previous.viewBox, current.viewBox) || externalViewport || externalPaint) {
      const entry = { ...current, display: { ...current.authoritative }, pending: false };
      cached.set(view.id, entry);
      return entry;
    }
    return previous;
  }

  function observeContent(view, content) {
    const entry = observed.get(view.id);
    if (!entry || entry.content === content) return;
    entry.contentObserver?.disconnect();
    entry.content = content;
    entry.contentObserver = MutationObserverClass ? new MutationObserverClass(() => capture()) : null;
    entry.contentObserver?.observe(content, { attributes: true, attributeFilter: ["transform"] });
  }

  function capture() {
    if (disposed) return;
    for (const view of read()) {
      const current = snapshot(view);
      if (!current) { cached.delete(view.id); continue; }
      ensureEntry(view, current);
      observeContent(view, current.content);
    }
  }

  function update(preview) {
    if (disposed) return;
    const commits = [];
    for (const view of read()) {
      const current = snapshot(view);
      if (!current) { cached.delete(view.id); continue; }
      const entry = ensureEntry(view, current);
      observeContent(view, current.content);
      const next = getResizedViewportTransform(entry.display, entry.viewBox, entry.size, current.size);
      const changed = !sameViewport(entry.display, next);
      entry.size = current.size;
      entry.display = next;
      entry.pending ||= changed;
      if (changed) current.content.setAttribute("transform", formatViewportTransform(next));
      if (!preview && entry.pending) commits.push([view.id, entry]);
    }
    // Gather both Compare views before an adapter reapplies either shared DOM.
    for (const [id, entry] of commits) {
      commit(id, { ...entry.display });
      entry.authoritative = { ...entry.display };
      entry.pending = false;
    }
  }

  function refresh() {
    if (disposed) return;
    // An explicit viewport action (including a same-value Fit) establishes a
    // new baseline. Internal observers still use capture to preserve resize
    // deltas when the browser has already performed the CSS reflow.
    frame.cancel();
    clearTimer(settleTimer);
    settleTimer = null;
    previewGesture = false;
    cached.clear();
    capture();
  }

  capture();
  return Object.freeze({
    onViewportResize(event = {}) {
      if (disposed) return;
      if (event.phase === "before") {
        clearTimer(settleTimer);
        settleTimer = null;
        frame.cancel();
        capture();
        return;
      }
      if (event.phase !== "after") return;
      previewGesture = event.reason === "resize" && Boolean(event.preview);
      const preview = Boolean(event.preview) || event.reason === "viewport";
      update(preview);
      if (preview && !previewGesture) scheduleCommit();
    },
    refresh,
    dispose() {
      if (disposed) return;
      disposed = true;
      frame.cancel();
      clearTimer(settleTimer);
      sizeObserver?.disconnect();
      for (const entry of observed.values()) {
        entry.mountObserver?.disconnect();
        entry.contentObserver?.disconnect();
      }
      cached.clear();
      observed.clear();
    }
  });
}

function sameViewport(left, right) {
  return left.x === right.x && left.y === right.y && left.scale === right.scale;
}

function sameViewBox(left, right) {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}
