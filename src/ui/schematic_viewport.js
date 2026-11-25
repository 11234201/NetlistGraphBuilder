import { formatViewportTransform, svgViewportComponents } from "./viewport.js";

// At overview scales a glyph is smaller than a pixel. Move the retained SVG
// layer as a unit there; readable scales always use native vector painting.
const MAX_OVERVIEW_UNIT_PIXELS = 0.1;
const MIN_OVERVIEW_NODES = 1024;
const MAX_OVERVIEW_SCALE = 64;

export function schematicViewportRect(svg) {
  return (svg?.hasAttribute?.("data-composited-viewport") ? svg.parentElement : svg)?.getBoundingClientRect();
}

export function paintSchematicViewport(content, viewport) {
  const svg = content.ownerSVGElement;
  const eligible = Number(svg?.dataset?.sceneNodes) >= MIN_OVERVIEW_NODES;
  const active = svg?.hasAttribute?.("data-composited-viewport");
  const box = svg?.viewBox?.baseVal;
  const host = svg?.parentElement;
  if (eligible && viewport.scale <= MAX_OVERVIEW_SCALE && box?.width && box.height && host) {
    const width = host.clientWidth, height = host.clientHeight;
    const unit = Math.min(width / box.width, height / box.height);
    if (unit > 0 && unit * viewport.scale <= MAX_OVERVIEW_UNIT_PIXELS) {
      if (!active) {
        svg.setAttribute("data-composited-viewport", "");
        svg.classList.remove("is-vector-panning", "is-vector-zooming");
      }
      // preserveAspectRatio=xMidYMid meet centers the viewBox inside the mount.
      const originX = (width - box.width * unit) / 2 - box.x * unit;
      const originY = (height - box.height * unit) / 2 - box.y * unit;
      const { scale, translatedX, translatedY } = svgViewportComponents(viewport);
      const dx = translatedX * scale * unit + (1 - scale) * originX;
      const dy = translatedY * scale * unit + (1 - scale) * originY;
      svg.style.transform = `matrix(${scale},0,0,${scale},${dx},${dy})`;
      content.setAttribute("transform", formatViewportTransform(viewport));
      return;
    }
  }
  if (active) {
    svg.removeAttribute("data-composited-viewport");
    svg.style.removeProperty("transform");
    const canvas = svg.closest(".canvas");
    svg.classList.toggle("is-vector-panning", !!canvas?.classList.contains("is-panning"));
    svg.classList.toggle("is-vector-zooming", !!canvas?.classList.contains("is-view-interacting"));
  }
  content.setAttribute("transform", formatViewportTransform(viewport));
}

export function setVectorGesturePreview(canvas, className, active) {
  for (const svg of canvas.querySelectorAll?.(".schematic-mount > svg") || []) {
    if (!svg.hasAttribute("data-composited-viewport")) svg.classList.toggle(className, active);
  }
}
