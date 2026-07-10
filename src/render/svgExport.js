const EXPORT_CSS = `
:root { --wire: #64748b; --selected: #c2410c; }
.schematic-svg { background: #f4f6f8; font-family: "Segoe UI", Arial, sans-serif; }
.wire, .wire-bridge { fill: none; stroke: var(--wire); stroke-width: 1.6; }
.wire-hit-area { fill: none; stroke: transparent; stroke-width: 14; }
.wire-bridge-cutout { fill: none; stroke: #f4f6f8; stroke-width: 5; stroke-linecap: round; }
.wire-label { font-size: 11px; fill: #475569; paint-order: stroke; stroke: #f8fafc; stroke-width: 4px; stroke-linejoin: round; }
.node-shape { fill: #fff; stroke: #334155; stroke-width: 1.4; }
.node.input .node-shape { fill: #e7f3f4; stroke: #1f7a8c; }
.node.output .node-shape { fill: #f8ecd8; stroke: #a15c00; }
.gate-kind { font-size: 12px; font-weight: 700; fill: #111827; }
.node-label { font-size: 11px; fill: #475569; }
.node-meta { font-size: 8px; fill: #687789; }
.pin-label { font-size: 9px; fill: #64748b; }
.pin-dot { fill: #334155; }
.pin-bubble { fill: #fff; stroke: #334155; stroke-width: 1.4; }
.timing-badge rect { fill: #fff7ed; stroke: #c2410c; }
.timing-badge text { font-size: 9px; fill: #9a3412; }
.node.timing-critical .node-shape { stroke: #b91c1c; stroke-width: 2.4; }
.pin-critical { fill: #b91c1c; stroke: #b91c1c; }
`;

export function createStandaloneSvg(svgMarkup) {
  const markup = String(svgMarkup || "");
  const openingEnd = markup.indexOf(">");
  if (!markup.startsWith("<svg") || openingEnd < 0) {
    throw new Error("Expected SVG markup");
  }
  const opening = markup.slice(0, openingEnd)
    .replace(/\sxmlns="[^"]*"/, "") + ' xmlns="http://www.w3.org/2000/svg">';
  return `<?xml version="1.0" encoding="UTF-8"?>\n${opening}<style>${EXPORT_CSS}</style>${markup.slice(openingEnd + 1)}`;
}
