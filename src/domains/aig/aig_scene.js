import { createSvgScene, svgElement as el, svgText } from "../../render/svg_scene_renderer.js";
import { normalizeAigPresentation, createAigPresentationIndex, aigNodeStyle, aigEdgeStyle } from "./aig_presentation.js";

export function createAigScene(model, analysis, geometry, presentation = {}, selectedId = null) {
  const policy = normalizeAigPresentation(presentation);
  const index = createAigPresentationIndex(model, analysis);
  const title = (text) => el("title", {}, [svgText(text)]);
  function nodePrimitive(positioned) {
    const node = index.nodes.get(positioned.id);
    const style = aigNodeStyle(node, analysis, index, policy);
    return el("g", { "data-aig-node": node.id, "data-aig-object": node.id, "data-domain-object": node.id, class: "aig-node", tabindex: 0,
      role: "button", "aria-label": `${node.kind}: ${node.label}` }, [title(node.label),
      el("rect", { class: "aig-selection-halo", x: positioned.x - 5, y: positioned.y - 5,
        width: positioned.width + 10, height: positioned.height + 10, rx: 6, fill: "none", stroke: "#2563eb",
        "stroke-width": 3, visibility: selectedId === node.id ? "visible" : "hidden", "pointer-events": "none" }),
      ...positioned.shapes.map((shape) => primitive(shape, { ...style, class: "aig-node-shape" })),
      ...positioned.labels.map(labelPrimitive)]);
  }
  function edgePrimitive(positioned) {
    const edge = index.edges.get(positioned.id);
    const style = aigEdgeStyle(edge, index, policy);
    return el("g", { "data-aig-edge": edge.id, "data-aig-object": edge.id, "data-domain-object": edge.id, class: "aig-edge", tabindex: 0,
      role: "button", "aria-label": `${edge.source} to ${edge.target}, slot ${edge.slot}, ${edge.inverted ? "inverted" : "positive"}` }, [
      title(`${edge.id}: ${edge.inverted ? "inverted" : "positive"}, input ${edge.slot}`),
      ...positioned.paths.map((d) => el("path", { d, class: "aig-selection-halo", fill: "none", stroke: "#60a5fa",
        "stroke-width": 8, opacity: 0.6, visibility: selectedId === edge.id ? "visible" : "hidden", "pointer-events": "none" })),
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
  return el("text", { x: label.x, y: label.y, "font-family": label.fontFamily || "Arial", "font-size": label.fontSize,
    "text-anchor": label.textAnchor, style: "white-space:pre", fill: "#0f172a", "pointer-events": "none" }, [svgText(label.text)]);
}
