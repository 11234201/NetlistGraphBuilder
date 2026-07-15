import { isInvertingOutputGate } from "../infer/defaultCellRules.js";
import { getLeafDisplayName } from "../layout/nodeGeometry.js";
import { segmentsConflict } from "../layout/orthogonalRouting.js";
import { getEdgeRouteSegments } from "../layout/routeSegmentIndex.js";
import { RouteSegmentIndex } from "../layout/spatialIndex.js";

const MAX_WIRE_BRIDGES = 2000;

export function renderSchematicSvg(graph) {
  const plan = createSchematicRenderPlan(graph);
  return `${plan.openSvg}${plan.edges.join("")}${plan.betweenGroups}${plan.nodes.join("")}${plan.closeSvg}`;
}

export function createSchematicRenderPlan(graph) {
  const width = Math.max(640, Math.ceil(graph.width || 640));
  const height = Math.max(420, Math.ceil(graph.height || 420));
  const crossingByEdge = findWireCrossings(graph.edges);
  const edges = graph.edges.map((edge) => renderEdge(edge, crossingByEdge.get(edge.id) || []));
  const nodes = graph.nodes.map(renderNode);
  return {
    edges,
    nodes,
    openSvg: `<svg class="schematic-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(graph.moduleDisplayName)} schematic">
  <g id="schematicContent">
    <g class="edges">`,
    betweenGroups: `</g><g class="nodes">`,
    closeSvg: `</g></g></svg>`
  };
}

function renderEdge(edge, crossings) {
  const path = edge.points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${round(point.x)} ${round(point.y)}`)
    .join(" ");
  const bridges = crossings.map(renderWireBridge).join("");
  const label = edge.showLabel === false
    ? ""
    : `<text class="wire-label" x="${round(edge.labelPoint.x)}" y="${round(edge.labelPoint.y)}" text-anchor="${escapeAttr(edge.labelAnchor || "start")}">${escapeHtml(edge.label)}</text>`;

  return `<g class="edge" data-edge-id="${escapeAttr(edge.id)}" data-net="${escapeAttr(edge.net)}">
    <path class="wire-hit-area" d="${path}" pointer-events="stroke"></path>
    <path class="wire" d="${path}"></path>
    ${bridges}
    ${label}
  </g>`;
}

function renderWireBridge(crossing) {
  const radius = 5;
  const x = round(crossing.x);
  const y = round(crossing.y);
  const d = `M ${x - radius} ${y} Q ${x} ${y - radius} ${x + radius} ${y}`;
  return `<path class="wire-bridge-cutout" d="${d}"></path><path class="wire-bridge" d="${d}"></path>`;
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
  if (node.kind === "hub") {
    return renderHubNode(node);
  }
  return renderGateNode(node);
}

function renderHubNode(node) {
  const cx = round(node.x + node.width / 2);
  const cy = round(node.y + node.height / 2);
  return `<g class="node hub" data-node-id="${escapeAttr(node.id)}" data-kind="hub" data-label="${escapeAttr(node.label)}">
    <title>${escapeHtml(`Fanout: ${node.label}`)}</title>
    <circle class="node-shape" cx="${cx}" cy="${cy}" r="5"></circle>
  </g>`;
}

function findWireCrossings(edges) {
  const crossings = new Map();
  const segmentIndex = new RouteSegmentIndex();
  let bridgeCount = 0;

  for (const edge of edges) {
    for (const edgeSegment of getEdgeRouteSegments(edge)) {
      const { orientation } = edgeSegment;
      if (!orientation) continue;
      const segment = edgeSegment;
      for (const existing of segmentIndex.querySegment(segment)) {
        if (
          existing.orientation === orientation ||
          existing.edgeId === edge.id ||
          existing.net === edge.net ||
          !segmentsConflict(existing, segment)
        ) continue;
        const horizontal = orientation === "horizontal" ? segment : existing;
        const vertical = orientation === "vertical" ? segment : existing;
        addCrossing(crossings, horizontal.edgeId, {
          x: vertical.start.x,
          y: horizontal.start.y
        });
        bridgeCount += 1;
        // Beyond this point bridges stop conveying useful information. Returning
        // none avoids both a dense SVG and a data-dependent render-time cliff.
        if (bridgeCount > MAX_WIRE_BRIDGES) return new Map();
      }
      segmentIndex.push(segment);
    }
  }

  return crossings;
}

function addCrossing(crossings, edgeId, crossing) {
  if (!crossings.has(edgeId)) {
    crossings.set(edgeId, []);
  }
  crossings.get(edgeId).push(crossing);
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
    <text class="node-label" x="${x + width / 2}" y="${y + height / 2 + 4}" text-anchor="middle">${escapeHtml(getLeafDisplayName(node.label))}</text>
  </g>`;
}

function renderSimpleNode(node, className) {
  const x = round(node.x);
  const y = round(node.y);
  const width = round(node.width);
  const height = round(node.height);

  return `<g class="node ${className}" data-node-id="${escapeAttr(node.id)}" data-kind="${escapeAttr(node.kind)}" data-label="${escapeAttr(node.label)}">
    <rect class="node-shape" x="${x}" y="${y}" width="${width}" height="${height}"></rect>
    <text class="node-label" x="${x + width / 2}" y="${y + height / 2 + 4}" text-anchor="middle">${escapeHtml(getLeafDisplayName(node.label))}</text>
  </g>`;
}

function renderGateNode(node) {
  const x = round(node.x);
  const y = round(node.y);
  const width = round(node.width);
  const height = round(node.height);
  const gateKind = node.gateKind || "blackbox";
  const ports = renderGatePorts(node, x, y, width, gateKind);
  const timingClass = getTimingClass(node);
  const timingBadge = renderTimingBadge(node, x, y, width, height);
  const cellTitle = node.subtitle
    ? `<title>${escapeHtml(`${node.subtitle}: ${node.label}${node.metadataText ? `; ${node.metadataText}` : ""}`)}</title>`
    : "";
  const metadata = node.kind === "cell" && node.metadataText && getTimingBadgeLines(node).length === 0
    ? `<text class="node-meta" x="${x + width / 2}" y="${y + height - 6}" text-anchor="middle">${escapeHtml(truncateText(node.metadataText, 34))}</text>`
    : "";

  return `<g class="node ${escapeAttr(gateKind)} ${escapeAttr(node.kind)}${timingClass}" data-node-id="${escapeAttr(node.id)}" data-kind="${escapeAttr(node.kind)}" data-label="${escapeAttr(node.label)}">
    ${cellTitle}
    <rect class="node-shape" x="${x}" y="${y}" width="${width}" height="${height}"></rect>
    ${ports}
    ${timingBadge}
    <text class="gate-kind" x="${x + width / 2}" y="${y + 22}" text-anchor="middle">${escapeHtml(node.title || gateKind.toUpperCase())}</text>
    <text class="node-label" x="${x + width / 2}" y="${y + 42}" text-anchor="middle">${escapeHtml(getLeafDisplayName(node.label))}</text>
    ${metadata}
  </g>`;
}

function truncateText(value, maxLength) {
  const text = String(value || "");
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

function renderGatePorts(node, x, y, width, gateKind) {
  return (node.ports || [])
    .map((port) => {
      const px = round(x + port.x);
      const py = round(y + port.y);
      const isOutput = port.direction === "output";
      const isVerticalPort = port.side === "top" || port.side === "bottom";
      const labelX = isVerticalPort ? px : isOutput ? px - 6 : px + 6;
      const labelY = port.side === "top" ? py + 13 : port.side === "bottom" ? py - 7 : py + 3;
      const anchor = isVerticalPort ? "middle" : isOutput ? "end" : "start";
      const timing = node.timing?.pins?.[port.pin];
      const timingClass = timing ? (timing.slack < 0 ? " pin-critical" : " pin-timing") : "";
      const timingTitle = timing
        ? `<title>${escapeHtml(`${port.pin}: at ${formatTimingValue(timing.at)}, rt ${formatTimingValue(timing.rt)}, slack ${formatTimingValue(timing.slack)}`)}</title>`
        : "";
      const marker = isOutput && isInvertingOutputGate(gateKind)
        ? `<circle class="pin-bubble${timingClass}" cx="${round(x + width + 5)}" cy="${py}" r="5">${timingTitle}</circle>`
        : `<circle class="pin-dot${timingClass}" cx="${px}" cy="${py}" r="2.4">${timingTitle}</circle>`;

      return `${marker}<text class="pin-label" x="${labelX}" y="${labelY}" text-anchor="${anchor}">${escapeHtml(port.pin)}</text>`;
    })
    .join("");
}

function getTimingClass(node) {
  if (!node.timing) {
    return "";
  }
  return node.timing.worstSlack < 0 ? " timing-critical" : " timing-annotated";
}

function renderTimingBadge(node, x, y, width, height) {
  const lines = getTimingBadgeLines(node);
  if (lines.length === 0) {
    return "";
  }
  const position = node.timing?.badgePosition || "bottom-right";
  const isLeft = position.endsWith("left");
  const isBottom = position.startsWith("bottom");
  const badgeX = round(isLeft ? x + 6 : x + width - 6);
  const badgeY = round(isBottom ? y + height - 8 - (lines.length - 1) * 11 : y + 14);
  const anchor = isLeft ? "start" : "end";
  const tspans = lines
    .map((line, index) => `<tspan x="${badgeX}" dy="${index === 0 ? 0 : 11}">${escapeHtml(line)}</tspan>`)
    .join("");
  return `<text class="timing-badge timing-badge-${position}" x="${badgeX}" y="${badgeY}" text-anchor="${anchor}">${tspans}</text>`;
}

function getTimingBadgeLines(node) {
  if (Array.isArray(node.timing?.badges)) {
    const badges = node.timing.badges;
    const byPin = new Map();
    for (const badge of badges) {
      if (!byPin.has(badge.pin)) {
        byPin.set(badge.pin, []);
      }
      byPin.get(badge.pin).push(`${badge.metric} ${formatTimingValue(badge.value)}`);
    }
    return [...byPin].map(([pin, values]) => `${pin} ${values.join(" ")}`);
  }
  if (node.timing?.badge) {
    return [node.timing.badge.label];
  }
  if (Number.isFinite(node.timing?.worstSlack)) {
    return [formatTimingValue(node.timing.worstSlack)];
  }
  return [];
}

function formatTimingValue(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return Number(value).toFixed(3);
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
