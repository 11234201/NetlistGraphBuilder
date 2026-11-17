import { svgElement as el, svgText } from "../../render/svg_scene_renderer.js";
import { SpatialHashIndex } from "../../layout/spatialIndex.js";
import { createStructureQuery, AIG_BLOCK_NAMES } from "./structure_query.js";

export const AIG_STRUCTURE_COLORS = Object.freeze({ a: "#1776c8", b: "#c16a16", path: "#087587", stem: "#087587", merge: "#087587", block: "#7950b6", boundary: "#7950b6" });
const labelCache = new WeakMap();

function blockLabels(geometry, data, query) {
  if (!data) return new Map();
  let byData = labelCache.get(geometry);
  if (!byData) { byData = new WeakMap(); labelCache.set(geometry, byData); }
  if (byData.has(data)) return byData.get(data);
  const labels = new Map(), occupied = new SpatialHashIndex(), positions = new Map();
  for (const node of geometry.nodes) { occupied.insert(node, node); positions.set(node.id, node); }
  const overlaps = (a, b) => a.x < b.x + b.width + 2 && a.x + a.width + 2 > b.x && a.y < b.y + b.height + 2 && a.y + a.height + 2 > b.y;
  for (const [id, blocks] of query.rootEntries()) {
    const node = positions.get(id);
    if (!node) continue;
    const names = [...new Set(blocks.map((block) => AIG_BLOCK_NAMES[block.kind]))].sort();
    const text = names.join(" / "), width = text.length * 6.2 + 10, height = 17;
    const candidates = [
      { x: node.x + (node.width - width) / 2, y: node.y - height - 4 },
      { x: node.x + (node.width - width) / 2, y: node.y + node.height + 4 },
      { x: node.x + node.width + 5, y: node.y + (node.height - height) / 2 },
      { x: node.x - width - 5, y: node.y + (node.height - height) / 2 }
    ].map((point) => ({ ...point, width, height }));
    const box = candidates.find((candidate) => {
      if (candidate.x < 0 || candidate.y < 0 || candidate.x + width > geometry.bounds.width || candidate.y + height > geometry.bounds.height) return false;
      const neighbors = occupied.query(candidate);
      return neighbors.length <= 256 && !neighbors.some((other) => overlaps(candidate, other));
    });
    if (!box) continue; // The list remains authoritative when no safe label slot exists.
    occupied.insert(box, box);
    labels.set(id, el("g", { class: "aig-block-label", "pointer-events": "none" }, [
      el("rect", { ...box, rx: 3, fill: "#ffffff", stroke: "#cbd5e1", "stroke-width": 1 }),
      el("text", { x: box.x + width / 2, y: box.y + 12, "text-anchor": "middle", "font-family": "Arial", "font-size": 10, fill: "#334155" }, [svgText(text)])
    ]));
  }
  byData.set(data, labels); return labels;
}

export function createStructurePresentation(geometry, view = {}, policy = {}) {
  const query = createStructureQuery(view.data), selected = query?.get(view.selectedId);
  const nodeRoles = new Map(), edgeRoles = new Map();
  if (selected?.category === "block") {
    for (const id of selected.boundaryIds) nodeRoles.set(id, "boundary");
    for (const id of selected.nodeIds) nodeRoles.set(id, "block");
    for (const id of selected.edgeIds) edgeRoles.set(id, "block");
  } else if (selected) {
    const detail = view.detail?.id === selected.id ? view.detail : null;
    for (const id of detail?.nodeIds || selected.paths.flatMap((path) => path.nodeIds)) nodeRoles.set(id, "path");
    for (const id of detail?.edgeIds || selected.paths.flatMap((path) => path.edgeIds)) edgeRoles.set(id, "path");
    selected.paths.forEach((path, slot) => { for (const id of path.edgeIds) edgeRoles.set(id, slot ? "b" : "a"); });
    nodeRoles.set(selected.stemId, "stem"); nodeRoles.set(selected.mergeId, "merge");
  }
  const labels = blockLabels(geometry, view.data, query);
  return { active: Boolean(selected), dim: policy.structureDim !== false, labelsVisible: policy.structureLabels !== false,
    nodeRoles, edgeRoles, labels,
    edgeStyle(id) { const role = edgeRoles.get(id); return role ? { stroke: AIG_STRUCTURE_COLORS[role], "stroke-width": 3.2 } : null; },
    nodeOverlay(positioned) {
      const role = nodeRoles.get(positioned.id);
      if (!role) return [];
      const color = AIG_STRUCTURE_COLORS[role];
      const parts = [el("rect", { class: "aig-analysis-halo", x: positioned.x - 6, y: positioned.y - 6,
        width: positioned.width + 12, height: positioned.height + 12, rx: 8, fill: "none", stroke: color,
        "stroke-width": role === "boundary" ? 2 : 3, opacity: 0.65, "pointer-events": "none" })];
      if (role === "stem" || role === "merge") parts.push(el("text", { class: "aig-analysis-role-label", x: positioned.x + positioned.width + 9,
        y: positioned.y + positioned.height / 2 + 4, "font-family": "Arial", "font-size": 10, fill: color, "pointer-events": "none" }, [svgText(role === "stem" ? "Stem" : "Merge")]));
      return parts;
    }
  };
}
