import { isInvertingOutputGate } from "../infer/defaultCellRules.js";

export function renderSchematicSvg(graph) {
  const width = Math.max(640, Math.ceil(graph.width || 640));
  const height = Math.max(420, Math.ceil(graph.height || 420));
  const edges = graph.edges.map(renderEdge).join("");
  const nodes = graph.nodes.map(renderNode).join("");

  return `<svg class="schematic-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(graph.moduleDisplayName)} schematic">
  <g id="schematicContent">
    <g class="edges">${edges}</g>
    <g class="nodes">${nodes}</g>
  </g>
</svg>`;
}

function renderEdge(edge) {
  const path = edge.points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${round(point.x)} ${round(point.y)}`)
    .join(" ");

  return `<g class="edge" data-edge-id="${escapeAttr(edge.id)}" data-net="${escapeAttr(edge.net)}">
    <path class="wire" d="${path}"></path>
    <text class="wire-label" x="${round(edge.labelPoint.x)}" y="${round(edge.labelPoint.y)}">${escapeHtml(edge.label)}</text>
  </g>`;
}

function renderNode(node) {
  if (node.kind === "input") {
    return renderPortNode(node, "input");
  }
  if (node.kind === "output") {
    return renderPortNode(node, "output");
  }
  if (node.kind === "implicit" || node.kind === "constant") {
    return renderSimpleNode(node, node.kind);
  }
  return renderGateNode(node);
}

function renderPortNode(node, portKind) {
  const x = round(node.x);
  const y = round(node.y);
  const width = round(node.width);
  const height = round(node.height);
  const points =
    portKind === "input"
      ? `${x},${y} ${x + width - 14},${y} ${x + width},${y + height / 2} ${x + width - 14},${y + height} ${x},${y + height}`
      : `${x + 14},${y} ${x + width},${y} ${x + width},${y + height} ${x + 14},${y + height} ${x},${y + height / 2}`;

  return `<g class="node ${portKind}" data-node-id="${escapeAttr(node.id)}" data-kind="${escapeAttr(node.kind)}" data-label="${escapeAttr(node.label)}">
    <polygon class="node-shape" points="${points}"></polygon>
    <text class="node-label" x="${x + width / 2}" y="${y + height / 2 + 4}" text-anchor="middle">${escapeHtml(node.label)}</text>
  </g>`;
}

function renderSimpleNode(node, className) {
  const x = round(node.x);
  const y = round(node.y);
  const width = round(node.width);
  const height = round(node.height);

  return `<g class="node ${className}" data-node-id="${escapeAttr(node.id)}" data-kind="${escapeAttr(node.kind)}" data-label="${escapeAttr(node.label)}">
    <rect class="node-shape" x="${x}" y="${y}" width="${width}" height="${height}"></rect>
    <text class="node-label" x="${x + width / 2}" y="${y + height / 2 + 4}" text-anchor="middle">${escapeHtml(node.label)}</text>
  </g>`;
}

function renderGateNode(node) {
  const x = round(node.x);
  const y = round(node.y);
  const width = round(node.width);
  const height = round(node.height);
  const gateKind = node.gateKind || "blackbox";
  const ports = renderGatePorts(node, x, y, width, gateKind);

  return `<g class="node ${escapeAttr(gateKind)} ${escapeAttr(node.kind)}" data-node-id="${escapeAttr(node.id)}" data-kind="${escapeAttr(node.kind)}" data-label="${escapeAttr(node.label)}">
    <rect class="node-shape" x="${x}" y="${y}" width="${width}" height="${height}"></rect>
    ${ports}
    <text class="gate-kind" x="${x + width / 2}" y="${y + 22}" text-anchor="middle">${escapeHtml(node.title || gateKind.toUpperCase())}</text>
    <text class="node-label" x="${x + width / 2}" y="${y + 42}" text-anchor="middle">${escapeHtml(node.label)}</text>
  </g>`;
}

function renderGatePorts(node, x, y, width, gateKind) {
  return (node.ports || [])
    .map((port) => {
      const px = round(x + port.x);
      const py = round(y + port.y);
      const isOutput = port.direction === "output";
      const labelX = isOutput ? px - 6 : px + 6;
      const anchor = isOutput ? "end" : "start";
      const marker = isOutput && isInvertingOutputGate(gateKind)
        ? `<circle class="pin-bubble" cx="${round(x + width + 5)}" cy="${py}" r="5"></circle>`
        : `<circle class="pin-dot" cx="${px}" cy="${py}" r="2.4"></circle>`;

      return `${marker}<text class="pin-label" x="${labelX}" y="${py + 3}" text-anchor="${anchor}">${escapeHtml(port.pin)}</text>`;
    })
    .join("");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

function round(value) {
  return Math.round(value * 10) / 10;
}
