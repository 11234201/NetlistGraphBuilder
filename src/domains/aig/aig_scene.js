import { createSvgScene, svgElement as el, svgText } from "../../render/svg_scene_renderer.js";
import { normalizeAigPresentation, aigNodeStyle, aigEdgeStyle } from "./aig_presentation.js";
import { createAigQuery } from "./aig_query.js";
import { describeAigSelection, AIG_NEIGHBOR_COLORS } from "./selection_highlights.js";
import { createStructurePresentation } from "./structure_presentation.js";

export function createAigScene(model, analysis, geometry, presentation = {}, selectedId = null, structureView = {}) {
  const policy = normalizeAigPresentation(presentation);
  const query = createAigQuery(model, analysis);
  const structure = createStructurePresentation(geometry, structureView, policy);
  const { roles: neighbors, dimOutside } = describeAigSelection(query, structure.active ? null : selectedId, policy);
  // Standalone SVG carries its own appearance; the live canvas uses a root selector.
  const traceStyle = (id) => dimOutside && id !== selectedId && !neighbors.has(id) ? "filter:grayscale(1);opacity:.35" : null;
  const neighborStyle = (id) => ({ class: "aig-neighbor-halo", fill: "none", "pointer-events": "none",
    stroke: AIG_NEIGHBOR_COLORS[neighbors.get(id)] || AIG_NEIGHBOR_COLORS.input,
    visibility: neighbors.has(id) ? "visible" : "hidden" });
  const title = (text) => el("title", {}, [svgText(text)]);
  function nodePrimitive(positioned) {
    const node = query.nodeById.get(positioned.id);
    const style = aigNodeStyle(node, analysis, query, policy);
    return el("g", { "data-aig-node": node.id, "data-aig-object": node.id, "data-domain-object": node.id, class: `aig-node${selectedId === node.id ? " is-selected" : ""}`, tabindex: 0,
      role: "button", "aria-label": `${node.kind}: ${node.label}`, "data-neighbor-role": neighbors.get(node.id),
      "data-aig-analysis-role": structure.nodeRoles.get(node.id), style: traceStyle(node.id),
      opacity: structure.active && structure.dim && !structure.nodeRoles.has(node.id) ? 0.22 : 1 }, [title(node.label),
      el("rect", { x: positioned.x - 4, y: positioned.y - 4, width: positioned.width + 8, height: positioned.height + 8,
        rx: 6, "stroke-width": 3, ...neighborStyle(node.id) }),
      el("rect", { class: "aig-selection-halo", x: positioned.x - 5, y: positioned.y - 5,
        width: positioned.width + 10, height: positioned.height + 10, rx: 6, fill: "none", stroke: "#7c3aed",
        "stroke-width": 3, visibility: selectedId === node.id ? "visible" : "hidden", "pointer-events": "none" }),
      ...positioned.shapes.map((shape) => primitive(shape, { ...style, class: "aig-node-shape" })),
      ...positioned.labels.map(labelPrimitive),
      el("g", { class: "aig-structure-selection" }, structure.nodeOverlay(positioned)),
      ...(structure.labelsVisible && structure.labels.has(node.id) ? [structure.labels.get(node.id)] : [])]);
  }
  function edgePrimitive(positioned) {
    const edge = query.edgeById.get(positioned.id);
    const style = { ...aigEdgeStyle(edge, query, policy), ...structure.edgeStyle(edge.id) };
    return el("g", { "data-aig-edge": edge.id, "data-aig-object": edge.id, "data-domain-object": edge.id, class: "aig-edge", tabindex: 0,
      role: "button", "aria-label": `${edge.source} to ${edge.target}, slot ${edge.slot}, ${edge.inverted ? "inverted" : "positive"}`,
      "data-neighbor-role": neighbors.get(edge.id), "data-aig-analysis-role": structure.edgeRoles.get(edge.id), style: traceStyle(edge.id),
      opacity: structure.active && structure.dim && !structure.edgeRoles.has(edge.id) ? 0.22 : 1 }, [
      title(`${edge.id}: ${edge.inverted ? "inverted" : "positive"}, input ${edge.slot}`),
      ...positioned.paths.map((d) => el("path", { d, "stroke-width": 7, "stroke-dasharray": style["stroke-dasharray"],
        opacity: 0.5, ...neighborStyle(edge.id) })),
      ...positioned.paths.map((d) => el("path", { d, class: "aig-selection-halo", fill: "none", stroke: "#7c3aed",
        "stroke-width": 8, "stroke-dasharray": style["stroke-dasharray"], opacity: 0.6,
        visibility: selectedId === edge.id ? "visible" : "hidden", "pointer-events": "none" })),
      ...positioned.paths.map((d) => el("path", { d, ...style, fill: "none", class: "aig-edge-path" })),
      ...positioned.arrows.map((shape) => primitive(shape, { class: "aig-edge-arrow", fill: style.stroke, stroke: style.stroke })),
      ...positioned.paths.map((d) => el("path", { d, fill: "none", stroke: "transparent", "stroke-width": 14,
        "pointer-events": "stroke", class: "aig-edge-hit" }))]);
  }
  return createSvgScene({ kind: "svg-scene.v1", bounds: geometry.bounds, ariaLabel: "AIG logic graph",
    nodeCount: geometry.nodes.length, edgeCount: geometry.edges.length,
    readNodes: (start, end) => geometry.nodes.slice(start, end).map(nodePrimitive),
    readEdges: (start, end) => geometry.edges.slice(start, end).map(edgePrimitive) });
}

function primitive(shape, attributes) {
  if (shape.type === "ellipse") return el("ellipse", { cx: shape.cx, cy: shape.cy, rx: shape.rx, ry: shape.ry, ...attributes });
  if (shape.type === "polygon") return el("polygon", { points: shape.points.map((point) => `${point.x},${point.y}`).join(" "), ...attributes });
  if (shape.type === "path") return el("path", { d: shape.d, ...attributes });
  throw new Error(`Unsupported curve shape: ${shape.type}`);
}

function labelPrimitive(label) {
  return el("text", { class: "aig-node-label", x: label.x, y: label.y, "font-family": label.fontFamily || "Arial", "font-size": label.fontSize,
    "text-anchor": label.textAnchor, style: "white-space:pre", fill: "#0f172a", "pointer-events": "none" }, [svgText(label.text)]);
}
