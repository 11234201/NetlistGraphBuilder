import { svgElement, svgText, serializeSvgPrimitive } from "./svg_scene_renderer.js";
import { levelText } from "../contracts/show_path.js";

const EXPORT_CSS = `
:root { --wire: #64748b; --selected: #c2410c; }
.schematic-svg { background: #f4f6f8; font-family: "Segoe UI", Arial, sans-serif; }
.wire, .wire-bridge { fill: none; stroke: var(--wire); stroke-width: 1.6; }
.wire-hit-area { fill: none; stroke: transparent; stroke-width: 14; }
.wire-bridge-cutout { fill: none; stroke: #f4f6f8; stroke-width: 5; stroke-linecap: round; }
.wire-label { font-size: 11px; fill: #475569; paint-order: stroke; stroke: #f8fafc; stroke-width: 4px; stroke-linejoin: round; }
.wire-junction { fill: var(--wire); }
.node-shape { fill: #fdfefe; stroke: #334155; stroke-width: 1.4; }
.node.gate-conventional .node-shape { stroke-linejoin: round; }
.gate-extra-shape { fill: none; stroke: #334155; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }
.gate-port-lead { stroke: #334155; stroke-width: 1.4; }
.node.is-compare-match .node-shape { stroke: #0f766e; stroke-width: 2.2; }
.node.is-compare-unmatched .node-shape { stroke: #dc2626; stroke-width: 2.2; stroke-dasharray: 5 3; }
.edge.is-compare-match .wire { stroke: #0f766e; stroke-width: 2.2; }
.edge.is-compare-unmatched .wire { stroke: #dc2626; stroke-width: 2.2; stroke-dasharray: 5 3; }
.node.input .node-shape { fill: #e7f3f4; stroke: #1f7a8c; }
.node.output .node-shape { fill: #fff7e6; stroke: #b7791f; }
.node.focus-input .node-shape, .node.focus-output .node-shape { fill: #f5f3ff; stroke: #7c3aed; stroke-dasharray: 5 3; }
.gate-kind { font-size: 12px; font-weight: 700; fill: #111827; }
.node-label { font-size: 11px; fill: #475569; }
.node-meta { font-size: 8px; fill: #687789; }
.pin-label { font-size: 9px; fill: #64748b; }
.pin-dot { fill: #fff; stroke: #334155; stroke-width: 1.2; }
.pin-bubble { fill: #fff; stroke: #111827; stroke-width: 1.3; }
.pin-dot.pin-timing, .pin-bubble.pin-timing { stroke: #2563eb; }
.pin-dot.pin-critical, .pin-bubble.pin-critical { fill: #fee2e2; stroke: #b91c1c; }
.timing-badge { font-size: 9px; font-weight: 700; fill: #b91c1c; paint-order: stroke; stroke: #fff; stroke-width: 3px; stroke-linejoin: round; }
.node.constant .node-shape, .node.implicit .node-shape { fill: #f1f5f9; stroke: #64748b; stroke-dasharray: 4 3; }
.node.blackbox .node-shape { fill: #f8fafc; stroke: #475569; stroke-dasharray: 6 3; }
.node.timing-annotated .node-shape { stroke: #2563eb; }
.node.timing-critical .node-shape { stroke: #b91c1c; }
.node.focused-root .node-shape { stroke: #7c3aed; stroke-width: 2.8; }
.node.focused-root-active .node-shape { stroke: #5b21b6; stroke-width: 4; }
.node.assign .node-shape { fill: #edf7ed; stroke: #2f855a; }
.node.hub .node-shape { fill: #dbeafe; stroke: #2563eb; }
.node.group .node-shape { fill: #f3e8ff; stroke: #7e22ce; stroke-width: 2; stroke-dasharray: 7 3; }
.node:is(.is-selected,.is-compare-counterpart) .node-shape { stroke-opacity: 0; }
.node:is(.is-selected,.is-compare-counterpart) .node-selection-outline { visibility: visible; }
.node.is-compare-unmatched .node-selection-outline { stroke-dasharray: 5 3; }
.node.gate-conventional .node-selection-outline { stroke-linejoin: round; }
.node.blackbox .node-selection-outline { stroke-dasharray: 6 3; }
.node.constant .node-selection-outline, .node.implicit .node-selection-outline { stroke-dasharray: 4 3; }
.node.focus-input .node-selection-outline, .node.focus-output .node-selection-outline { stroke-dasharray: 5 3; }
.edge:is(.is-selected,.is-compare-counterpart) .wire, .wire.is-selected { stroke: var(--selected); stroke-width: 2.6; }
[data-recon-role="a"] { --recon-color: #1776c8; }
[data-recon-role="b"] { --recon-color: #b45a16; }
[data-recon-role="shared"] { --recon-color: #833fa4; }
[data-recon-role="region"] { --recon-color: #368577; }
.node[data-recon-role] .node-shape, .edge[data-recon-role] .wire { stroke: var(--recon-color); stroke-width: 3.2; }
`;

export function createStandaloneSvg(svgMarkup, path, scope = "", display = {}) {
  let markup = String(svgMarkup || "");
  if (path) markup = appendPathReport(markup, path, scope, display);
  const openingEnd = markup.indexOf(">");
  if (!markup.startsWith("<svg") || openingEnd < 0) {
    throw new Error("Expected SVG markup");
  }
  const opening = markup.slice(0, openingEnd)
    .replace(/\sxmlns="[^"]*"/, "") + ' xmlns="http://www.w3.org/2000/svg">';
  return `<?xml version="1.0" encoding="UTF-8"?>\n${opening}<style>${EXPORT_CSS}</style>${markup.slice(openingEnd + 1)}`;
}

function appendPathReport(markup, path, scope, display) {
  const bounds = /viewBox="0 0 (\d+) (\d+)"/.exec(markup);
  if (!bounds) throw new Error("Show Path SVG requires scene bounds");
  const lines = ["Show Path · " + scope, [path.status, ...path.reasons,
    path.nodeIds.size + " nodes", path.edgeIds.size + " wires"].join(" · ")];
  if (display.boundaries) lines.push("Display boundaries: " + display.boundaries.length);
  if (display.truncated) lines.push("Focused budget reached");
  for (const [title, rows, count, automatic] of [["Starts", path.starts, path.startCount, path.automaticStarts],
    ["Ends", path.ends, path.endCount, path.automaticEnds]]) {
    lines.push(title + " (" + count + (automatic ? ", automatic)" : ")"));
    for (const row of rows) lines.push((row.name && row.name !== row.label ? row.name + " → " : "") +
      row.label + " · " + levelText(row) + (!row.reachable ? " · unreachable" : display.visible && !display.visible.has(row.displayId) ? " · outside Focused" : ""));
    if (rows.length < count) lines.push("Endpoint list truncated at " + rows.length);
  }
  const width = lines.reduce((w, line) => Math.max(w, 32 + 14 * line.length), Number(bounds[1]));
  const height = Number(bounds[2]), lineHeight = 19;
  const text = lines.map((line, i) => svgElement("text", { x: 16, y: height + (i + 1) * lineHeight }, [svgText(line)]));
  const report = serializeSvgPrimitive(svgElement("g", { "aria-label": "Show Path", fill: "#213247", "font-size": 13 }, text));
  return markup.replace(bounds[0], `viewBox="0 0 ${width} ${height + (lines.length + 1) * lineHeight}"`)
    .replace(/<\/svg>$/, () => report + "</svg>");
}
